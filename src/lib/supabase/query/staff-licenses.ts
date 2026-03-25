import type { Supabase } from '../types'

/** Get all staff_licenses for staff ids (any status). */
export async function getStaffLicensesByStaffMemberIds(
  supabase: Supabase,
  staffMemberIds: string[]
) {
  if (staffMemberIds.length === 0) return { data: [], error: null }
  return supabase
    .from('staff_licenses')
    .select('*')
    .in('staff_member_id', staffMemberIds)
}

/** Insert a staff_licenses row and return id. */
export async function insertStaffLicenseRow(
  supabase: Supabase,
  data: Record<string, unknown>
) {
  return supabase.from('staff_licenses').insert(data).select('id').single()
}
