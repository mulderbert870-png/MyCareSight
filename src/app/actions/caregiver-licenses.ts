'use server'

import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEffectiveCompanyOwnerUserId } from '@/lib/agency-scope'

export type InsertCaregiverLicenseInput = {
  staffMemberId: string
  licenseType: string
  licenseNumber: string
  state: string
  expiryDate: string | null
}

/**
 * Inserts a staff-linked applications row (caregiver license).
 * Uses the service role after verifying the signed-in user may manage this caregiver,
 * so inserts work even when RLS on `applications` has not been extended for client owners.
 */
export async function insertCaregiverLicenseApplicationAction(
  input: InsertCaregiverLicenseInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await getSession()
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in.' }
  }

  const userId = session.user.id
  const supabase = await createClient()

  const { data: profile } = await q.getUserProfileFull(supabase, userId)
  const effectiveOwnerId = getEffectiveCompanyOwnerUserId(profile, userId)
  if (!effectiveOwnerId) {
    return { ok: false, error: 'No organization scope found for this user.' }
  }

  const { data: client, error: clientErr } = await q.getClientByCompanyOwnerIdWithAgency(supabase, effectiveOwnerId)
  if (clientErr || !client?.id) {
    return { ok: false, error: 'No client account found for this user.' }
  }

  const { data: staff, error: staffErr } = await supabase
    .from('staff_members')
    .select('id, company_owner_id, agency_id')
    .eq('id', input.staffMemberId)
    .maybeSingle()

  if (staffErr || !staff) {
    return { ok: false, error: 'Caregiver not found or you do not have access.' }
  }

  const sameClient = staff.company_owner_id === client.id
  const sameAgency =
    Boolean(client.agency_id) &&
    Boolean(staff.agency_id) &&
    client.agency_id === staff.agency_id

  if (!sameClient && !sameAgency) {
    return {
      ok: false,
      error: 'You can only add licenses for caregivers in your organization.',
    }
  }

  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]

  let daysUntilExpiry: number | null = null
  if (input.expiryDate) {
    const expiryDate = new Date(input.expiryDate)
    const diffTime = expiryDate.getTime() - today.getTime()
    daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  }

  let status = 'approved'
  if (daysUntilExpiry !== null && daysUntilExpiry < 0) {
    status = 'rejected'
  }

  const row = {
    staff_member_id: input.staffMemberId,
    company_owner_id: null,
    application_name: input.licenseType.trim(),
    license_number: input.licenseNumber.trim(),
    state: input.state.trim() || '—',
    status,
    progress_percentage: 100,
    started_date: todayStr,
    last_updated_date: todayStr,
    submitted_date: todayStr,
    issue_date: null,
    expiry_date: input.expiryDate || null,
    days_until_expiry: daysUntilExpiry,
    issuing_authority: null,
  }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin.from('applications').insert(row).select('id').single()

    if (error) {
      return { ok: false, error: error.message || 'Failed to save license.' }
    }
    if (!data?.id) {
      return { ok: false, error: 'License was not saved. Please try again.' }
    }
    return { ok: true, id: data.id }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const missingServiceRole =
      msg.includes('SUPABASE_SERVICE_ROLE_KEY') || msg.includes('Missing SUPABASE_SERVICE_ROLE_KEY')

    if (missingServiceRole) {
      const { data, error } = await q.insertApplicationRow(supabase, row)
      if (error) {
        return {
          ok: false,
          error:
            `${error.message} If this is an RLS error, apply migrations phast_two/020 and 021 in Supabase, or set SUPABASE_SERVICE_ROLE_KEY on the server.`,
        }
      }
      if (!data?.id) {
        return {
          ok: false,
          error:
            'License was not saved. Set SUPABASE_SERVICE_ROLE_KEY on the server or apply staff-license RLS migrations (020, 021).',
        }
      }
      return { ok: true, id: data.id }
    }
    return { ok: false, error: msg || 'Failed to save license.' }
  }
}
