'use server'

import { createClient } from '@/lib/supabase/server'

export interface StaffCertificationReportRow {
  staff_name: string
  contact: string
  certification: string
  cert_number: string
  state: string
  issuing_authority: string
  issue_date: string
  expiration: string
  status: 'Active' | 'Expiring Soon' | 'Expired'
  certification_id?: string
  document_url?: string | null
}

export interface ExpiringCertificationReportRow {
  staff_name: string
  contact: string
  certification: string
  cert_number: string
  expiration: string
  status: 'Expiring Soon' | 'Expired'
  certification_id?: string
  document_url?: string | null
}

export interface StaffRosterReportRow {
  staff_name: string
  email: string
  phone: string
  role: string
  job_title: string
  status: string
}

export async function getStaffCertificationsReport() {
  const supabase = await createClient()

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'You must be logged in', data: null }
    }

    const { data: admin } = await supabase
      .from('agency_admins')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!admin?.id) {
      return { error: null, data: [] }
    }

    const { data: staffMembers, error: staffError } = await supabase
      .from('caregiver_members')
      .select('id, first_name, last_name, email, phone, user_id')
      .eq('company_owner_id', admin.id)
      .order('first_name', { ascending: true })

    if (staffError) {
      return { error: staffError.message, data: null }
    }

    if (!staffMembers || staffMembers.length === 0) {
      return { error: null, data: [] }
    }

    const staffIds = staffMembers.map((sm) => sm.id)

    const { data: credentials, error: certError } = await supabase
      .from('caregiver_credentials')
      .select('*')
      .in('caregiver_member_id', staffIds)
      .order('expiration_date', { ascending: true })

    if (certError) {
      return { error: certError.message, data: null }
    }

    const staffMap = new Map(staffMembers.map((sm) => [sm.user_id, sm]))
    const staffById = new Map(staffMembers.map((sm) => [sm.id, sm]))

    const reportData: StaffCertificationReportRow[] = (credentials || []).map((cert) => {
      const staff =
        (cert.user_id ? staffMap.get(cert.user_id as string) : undefined) ??
        (cert.caregiver_member_id ? staffById.get(cert.caregiver_member_id as string) : undefined)
      const expStr = cert.expiration_date as string | null
      const today = new Date()
      const expiry = expStr ? new Date(expStr) : today
      const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

      let status: 'Active' | 'Expiring Soon' | 'Expired'
      const st = String(cert.status || '')
      if (!expStr || daysUntilExpiry <= 0 || st === 'Expired') {
        status = 'Expired'
      } else if (daysUntilExpiry <= 90) {
        status = 'Expiring Soon'
      } else {
        status = 'Active'
      }

      const staffName = staff ? `${staff.first_name} ${staff.last_name}` : 'Unknown Staff'

      const contact = staff ? `${staff.email} ${staff.phone ? `(${staff.phone})` : ''}` : 'N/A'

      return {
        staff_name: staffName,
        contact: contact.trim(),
        certification: (cert.source_credential_name as string) || 'Credential',
        cert_number: (cert.credential_number as string) || '',
        state: (cert.state as string) || 'N/A',
        issuing_authority: (cert.issuing_authority as string) || 'N/A',
        issue_date: cert.issue_date
          ? new Date(cert.issue_date as string).toLocaleDateString('en-US', {
              month: '2-digit',
              day: '2-digit',
              year: 'numeric',
            })
          : 'N/A',
        expiration: expStr
          ? new Date(expStr).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
          : 'N/A',
        status,
        certification_id: cert.id as string,
        document_url: cert.document_url as string | null,
      }
    })

    return { error: null, data: reportData }
  } catch (err: any) {
    return { error: err.message || 'Failed to fetch report data', data: null }
  }
}

export async function getExpiringCertificationsReport() {
  const supabase = await createClient()

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'You must be logged in', data: null }
    }

    const { data: admin } = await supabase
      .from('agency_admins')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!admin?.id) {
      return { error: null, data: [] }
    }

    const { data: staffMembers, error: staffError } = await supabase
      .from('caregiver_members')
      .select('id, first_name, last_name, email, phone, user_id')
      .eq('company_owner_id', admin.id)
      .order('first_name', { ascending: true })

    if (staffError) {
      return { error: staffError.message, data: null }
    }

    if (!staffMembers || staffMembers.length === 0) {
      return { error: null, data: [] }
    }

    const staffIds = staffMembers.map((sm) => sm.id)

    const { data: credentials, error: certError } = await supabase
      .from('caregiver_credentials')
      .select('*')
      .in('caregiver_member_id', staffIds)
      .order('expiration_date', { ascending: true })

    if (certError) {
      return { error: certError.message, data: null }
    }

    const staffMap = new Map(staffMembers.map((sm) => [sm.user_id, sm]))
    const staffById = new Map(staffMembers.map((sm) => [sm.id, sm]))

    const today = new Date()

    const reportData: ExpiringCertificationReportRow[] = (credentials || [])
      .filter((cert) => {
        const expStr = cert.expiration_date as string | null
        if (!expStr) return String(cert.status || '') === 'Expired'
        const expiry = new Date(expStr)
        const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
        return daysUntilExpiry <= 90 || cert.status === 'Expired'
      })
      .map((cert) => {
        const staff =
          (cert.user_id ? staffMap.get(cert.user_id as string) : undefined) ??
          (cert.caregiver_member_id ? staffById.get(cert.caregiver_member_id as string) : undefined)
        const expStr = cert.expiration_date as string
        const expiry = new Date(expStr)
        const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

        let status: 'Expiring Soon' | 'Expired'
        if (daysUntilExpiry <= 0 || cert.status === 'Expired') {
          status = 'Expired'
        } else {
          status = 'Expiring Soon'
        }

        const staffName = staff ? `${staff.first_name} ${staff.last_name}` : 'Unknown Staff'

        const contact = staff ? `${staff.email} ${staff.phone ? `(${staff.phone})` : ''}` : 'N/A'

        return {
          staff_name: staffName,
          contact: contact.trim(),
          certification: (cert.source_credential_name as string) || 'Credential',
          cert_number: (cert.credential_number as string) || '',
          expiration: new Date(expStr).toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
          }),
          status,
          certification_id: cert.id as string,
          document_url: cert.document_url as string | null,
        }
      })

    return { error: null, data: reportData }
  } catch (err: any) {
    return { error: err.message || 'Failed to fetch report data', data: null }
  }
}

export async function getStaffRosterReport() {
  const supabase = await createClient()

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'You must be logged in', data: null }
    }

    const { data: admin } = await supabase
      .from('agency_admins')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!admin?.id) {
      return { error: null, data: [] }
    }

    const { data: staffMembers, error: staffError } = await supabase
      .from('caregiver_members')
      .select('id, first_name, last_name, email, phone, role, job_title, status')
      .eq('company_owner_id', admin.id)
      .order('first_name', { ascending: true })

    if (staffError) {
      return { error: staffError.message, data: null }
    }

    if (!staffMembers || staffMembers.length === 0) {
      return { error: null, data: [] }
    }

    const reportData: StaffRosterReportRow[] = staffMembers.map(staff => ({
      staff_name: `${staff.first_name} ${staff.last_name}`,
      email: staff.email,
      phone: staff.phone || 'N/A',
      role: staff.role || '—',
      job_title: staff.job_title || '—',
      status: staff.status || '—'
    }))

    return { error: null, data: reportData }
  } catch (err: any) {
    return { error: err.message || 'Failed to fetch report data', data: null }
  }
}
