'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import * as q from '@/lib/supabase/query'
import type { CreateCertificationData, UpdateCertificationData } from '@/app/actions/certifications'
import {
  updateCertification as updateLegacyCertificationTable,
  getCertification as getLegacyCertificationById,
} from '@/app/actions/certifications'

export type MyStaffCertificationUi = {
  id: string
  type: string
  license_number: string
  state: string | null
  issue_date: string | null
  expiration_date: string
  issuing_authority: string
  status: string
  document_url: string | null
  created_at: string
  updated_at: string
}

function computeExpiryFields(expiryDateStr: string) {
  const today = new Date()
  const expiryDateObj = new Date(expiryDateStr)
  const diffTime = expiryDateObj.getTime() - today.getTime()
  const daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  let status: 'active' | 'expiring' | 'expired' = 'active'
  if (daysUntilExpiry <= 0) status = 'expired'
  else if (daysUntilExpiry <= 30) status = 'expiring'
  return { days_until_expiry: daysUntilExpiry, status }
}

function mapLegacyCertificationsRowToUi(row: {
  id: string
  type: string
  license_number: string
  state: string | null
  issue_date: string | null
  expiration_date: string
  issuing_authority: string
  status: string
  document_url: string | null
  created_at: string
  updated_at: string
}): MyStaffCertificationUi {
  return {
    id: row.id,
    type: row.type,
    license_number: row.license_number,
    state: row.state,
    issue_date: row.issue_date,
    expiration_date: row.expiration_date,
    issuing_authority: row.issuing_authority?.trim() || 'N/A',
    status: row.status,
    document_url: row.document_url ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function mapRowToUi(row: {
  id: string
  license_type: string
  license_number: string
  state: string | null
  issue_date: string | null
  expiry_date: string
  issuing_authority?: string | null
  status: string
  document_url?: string | null
  created_at: string
  updated_at: string
}): MyStaffCertificationUi {
  const statusRaw = (row.status || '').toLowerCase()
  let displayStatus = 'Active'
  if (statusRaw === 'expired') displayStatus = 'Expired'
  else if (statusRaw === 'expiring') displayStatus = 'Expiring Soon'

  return {
    id: row.id,
    type: row.license_type,
    license_number: row.license_number,
    state: row.state,
    issue_date: row.issue_date,
    expiration_date: row.expiry_date,
    issuing_authority: row.issuing_authority?.trim() || 'N/A',
    status: displayStatus,
    document_url: row.document_url ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/** Certifications backed by staff_licenses for the logged-in caregiver's staff_member row. */
export async function getMyStaffCertifications(): Promise<{
  data: MyStaffCertificationUi[] | null
  error: string | null
  hasStaffProfile: boolean
}> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { data: null, error: 'You must be logged in', hasStaffProfile: false }
  }

  const { data: staff, error: staffError } = await q.getStaffMemberByUserId(supabase, user.id)
  if (staffError) {
    return { data: null, error: staffError.message, hasStaffProfile: false }
  }
  if (!staff?.id) {
    const { data: legacyOnly, error: legOnlyErr } = await supabase
      .from('certifications')
      .select('*')
      .eq('user_id', user.id)
      .order('expiration_date', { ascending: true })
    if (legOnlyErr) {
      return { data: null, error: legOnlyErr.message, hasStaffProfile: false }
    }
    const legacyList = (legacyOnly || []).map((r) =>
      mapLegacyCertificationsRowToUi(r as Parameters<typeof mapLegacyCertificationsRowToUi>[0])
    )
    return { data: legacyList, error: null, hasStaffProfile: false }
  }

  const { data: rows, error: licError } = await q.getStaffLicensesByStaffMemberIds(supabase, [staff.id])
  if (licError) {
    return { data: null, error: licError.message, hasStaffProfile: true }
  }

  const staffList = (rows || []).map((r) =>
    mapRowToUi(
      r as {
        id: string
        license_type: string
        license_number: string
        state: string | null
        issue_date: string | null
        expiry_date: string
        issuing_authority?: string | null
        status: string
        document_url?: string | null
        created_at: string
        updated_at: string
      }
    )
  )

  const { data: legacyRows, error: legacyErr } = await supabase
    .from('certifications')
    .select('*')
    .eq('user_id', user.id)

  if (legacyErr) {
    return { data: null, error: legacyErr.message, hasStaffProfile: true }
  }

  const legacyList = (legacyRows || []).map((r) =>
    mapLegacyCertificationsRowToUi(
      r as {
        id: string
        type: string
        license_number: string
        state: string | null
        issue_date: string | null
        expiration_date: string
        issuing_authority: string
        status: string
        document_url: string | null
        created_at: string
        updated_at: string
      }
    )
  )

  const list = [...staffList, ...legacyList].sort(
    (a, b) => new Date(a.expiration_date).getTime() - new Date(b.expiration_date).getTime()
  )

  return { data: list, error: null, hasStaffProfile: true }
}

export async function createMyStaffCertification(data: CreateCertificationData) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: 'You must be logged in to create a certification', data: null }
  }

  const { data: staff, error: staffError } = await q.getStaffMemberByUserId(supabase, user.id)
  if (staffError || !staff?.id) {
    return {
      error:
        'Your login is not linked to an agency staff profile. Ask your agency to connect your account so certifications stay in sync with the agency dashboard.',
      data: null,
    }
  }

  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const issueDate = data.issue_date?.trim() || todayStr
  const expiryDate = data.expiration_date.trim()
  const { days_until_expiry, status } = computeExpiryFields(expiryDate)

  const row = {
    staff_member_id: staff.id,
    license_type: data.type.trim(),
    license_number: data.license_number.trim(),
    state: (data.state?.trim() || '—') || '—',
    status,
    issue_date: issueDate,
    expiry_date: expiryDate,
    days_until_expiry,
    issuing_authority: data.issuing_authority.trim(),
    document_url: data.document_url ?? null,
  }

  const { data: inserted, error: insertError } = await supabase
    .from('staff_licenses')
    .insert(row)
    .select()
    .single()

  if (insertError) {
    return { error: insertError.message, data: null }
  }

  revalidatePath('/pages/caregiver/my-certifications')
  revalidatePath('/pages/caregiver')
  return { error: null, data: inserted ? mapRowToUi(inserted as Parameters<typeof mapRowToUi>[0]) : null }
}

export async function updateMyStaffCertification(certificationId: string, data: UpdateCertificationData) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: 'You must be logged in to update a certification', data: null }
  }

  const { data: staff, error: staffError } = await q.getStaffMemberByUserId(supabase, user.id)
  if (staffError || !staff?.id) {
    return {
      error:
        'Your login is not linked to an agency staff profile. Ask your agency to connect your account.',
      data: null,
    }
  }

  const { data: existing, error: fetchError } = await supabase
    .from('staff_licenses')
    .select('id')
    .eq('id', certificationId)
    .eq('staff_member_id', staff.id)
    .maybeSingle()

  if (fetchError || !existing) {
    return { error: 'Certification not found or you do not have access.', data: null }
  }

  const expiryDate = data.expiration_date.trim()
  const { days_until_expiry, status } = computeExpiryFields(expiryDate)

  const updatePayload = {
    license_type: data.type.trim(),
    license_number: data.license_number.trim(),
    state: (data.state?.trim() || '—') || '—',
    issue_date: data.issue_date?.trim() || null,
    expiry_date: expiryDate,
    days_until_expiry,
    status,
    issuing_authority: data.issuing_authority.trim(),
    document_url: data.document_url ?? null,
    updated_at: new Date().toISOString(),
  }

  const { data: updated, error: updateError } = await supabase
    .from('staff_licenses')
    .update(updatePayload)
    .eq('id', certificationId)
    .eq('staff_member_id', staff.id)
    .select()
    .single()

  if (updateError) {
    return { error: updateError.message, data: null }
  }

  revalidatePath('/pages/caregiver/my-certifications')
  revalidatePath(`/pages/caregiver/my-certifications/${certificationId}`)
  revalidatePath('/pages/caregiver')
  return { error: null, data: updated ? mapRowToUi(updated as Parameters<typeof mapRowToUi>[0]) : null }
}

export async function getMyStaffCertificationById(certificationId: string) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: 'You must be logged in', data: null }
  }

  const { data: staff, error: staffError } = await q.getStaffMemberByUserId(supabase, user.id)
  if (staffError || !staff?.id) {
    return { error: 'Staff profile not found', data: null }
  }

  const { data: row, error } = await supabase
    .from('staff_licenses')
    .select('*')
    .eq('id', certificationId)
    .eq('staff_member_id', staff.id)
    .maybeSingle()

  if (error) {
    return { error: error.message, data: null }
  }
  if (!row) {
    return { error: 'Not found', data: null }
  }

  return { error: null, data: mapRowToUi(row as Parameters<typeof mapRowToUi>[0]) }
}

/** Prefer staff_licenses row; fall back to legacy certifications table (edit from My Certifications). */
export async function updateUnifiedCaregiverCertification(
  certificationId: string,
  data: UpdateCertificationData
) {
  const staffTry = await updateMyStaffCertification(certificationId, data)
  if (!staffTry.error) return staffTry
  const err = (staffTry.error || '').toLowerCase()
  if (err.includes('not found') || err.includes('access')) {
    return updateLegacyCertificationTable(certificationId, data)
  }
  return staffTry
}

/** Detail view: staff license first, then legacy certifications. */
export async function getUnifiedCaregiverCertificationDetail(certificationId: string): Promise<{
  error: string | null
  data: MyStaffCertificationUi | null
}> {
  const staffResult = await getMyStaffCertificationById(certificationId)
  if (!staffResult.error && staffResult.data) {
    return { error: null, data: staffResult.data }
  }
  const legacyResult = await getLegacyCertificationById(certificationId)
  if (!legacyResult.error && legacyResult.data) {
    return {
      error: null,
      data: mapLegacyCertificationsRowToUi(
        legacyResult.data as Parameters<typeof mapLegacyCertificationsRowToUi>[0]
      ),
    }
  }
  return {
    error: staffResult.error || legacyResult.error || 'Not found',
    data: null,
  }
}
