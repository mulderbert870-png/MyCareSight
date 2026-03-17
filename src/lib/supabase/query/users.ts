import type { Supabase } from '../types'

export async function updateUserProfileUpdatedAt(supabase: Supabase, userId: string) {
  return supabase.from('user_profiles').update({ updated_at: new Date().toISOString() }).eq('id', userId)
}

export async function getUserProfileEmail(supabase: Supabase, userId: string) {
  return supabase.from('user_profiles').select('email').eq('id', userId).single()
}

export async function rpcUpdateUserPassword(supabase: Supabase, userId: string, newPassword: string) {
  return supabase.rpc('update_user_password', { p_user_id: userId, p_new_password: newPassword })
}

export async function insertClient(
  supabase: Supabase,
  data: { company_owner_id: string; contact_name: string; contact_email: string; status: string }
) {
  return supabase.from('clients').insert(data)
}

export async function getStaffMemberByUserId(supabase: Supabase, userId: string) {
  return supabase.from('staff_members').select('id').eq('user_id', userId).maybeSingle()
}

export async function insertStaffMember(
  supabase: Supabase,
  data: {
    user_id: string
    company_owner_id: string | null
    first_name: string
    last_name: string
    email: string
    role: string
    status: string
  }
) {
  return supabase.from('staff_members').insert(data)
}

/** Insert staff member and return the created row. */
export async function insertStaffMemberReturning(
  supabase: Supabase,
  data: Record<string, unknown>
) {
  return supabase.from('staff_members').insert(data).select().single()
}

/** Update staff member by id. */
export async function updateStaffMember(
  supabase: Supabase,
  staffId: string,
  data: Record<string, unknown>
) {
  return supabase.from('staff_members').update(data).eq('id', staffId)
}

/** Update user profile (full_name, role, updated_at). */
export async function updateUserProfile(
  supabase: Supabase,
  userId: string,
  data: { full_name?: string; role?: string; updated_at?: string }
) {
  return supabase.from('user_profiles').update(data).eq('id', userId)
}

/** Update user profile by id with arbitrary fields. */
export async function updateUserProfileById(
  supabase: Supabase,
  userId: string,
  data: Record<string, unknown>
) {
  return supabase.from('user_profiles').update(data).eq('id', userId)
}

/** Get licensing_expert id by user_id (for existence check). */
export async function getLicensingExpertIdByUserId(supabase: Supabase, userId: string) {
  return supabase.from('licensing_experts').select('id').eq('user_id', userId).maybeSingle()
}

export async function insertLicensingExpert(
  supabase: Supabase,
  data: {
    user_id: string
    first_name: string
    last_name: string
    email: string
    role: string
    status: string
  }
) {
  return supabase.from('licensing_experts').insert(data)
}

export async function getUserProfileByEmail(supabase: Supabase, email: string) {
  return supabase.from('user_profiles').select('id, role').eq('email', email).single()
}

/** Get user profile by id (id, full_name, email). */
export async function getUserProfileById(supabase: Supabase, userId: string) {
  return supabase.from('user_profiles').select('id, full_name, email').eq('id', userId).single()
}

/** Get full user profile by id (all columns). */
export async function getUserProfileFull(supabase: Supabase, userId: string) {
  return supabase.from('user_profiles').select('*').eq('id', userId).single()
}

/** Get staff members by company_owner_id (optional status filter), ordered by created_at desc. */
export async function getStaffMembersByCompanyOwnerId(
  supabase: Supabase,
  companyOwnerId: string,
  options?: { status?: string }
) {
  let query = supabase
    .from('staff_members')
    .select('*')
    .eq('company_owner_id', companyOwnerId)
    .order('created_at', { ascending: false })
  if (options?.status) query = query.eq('status', options.status)
  return query
}

/** Get user profile role by id. */
export async function getUserProfileRoleById(supabase: Supabase, userId: string) {
  return supabase.from('user_profiles').select('role').eq('id', userId).single()
}

/** Get user profiles by ids (optional select, default id, full_name, role). */
export async function getUserProfilesByIds(
  supabase: Supabase,
  userIds: string[],
  select = 'id, full_name, role'
) {
  if (userIds.length === 0) return { data: [], error: null }
  return supabase.from('user_profiles').select(select).in('id', userIds)
}

/** Get all user profiles ordered by full_name. */
export async function getUserProfilesOrdered(supabase: Supabase) {
  return supabase.from('user_profiles').select('*').order('full_name', { ascending: true })
}

/** Get all user profiles ordered by created_at desc. */
export async function getUserProfilesOrderedByCreatedAt(supabase: Supabase) {
  return supabase.from('user_profiles').select('*').order('created_at', { ascending: false })
}

/** Get user profiles by role, ordered by created_at desc. */
export async function getUserProfilesByRole(supabase: Supabase, role: string, select = '*') {
  return supabase
    .from('user_profiles')
    .select(select)
    .eq('role', role)
    .order('created_at', { ascending: false })
}

/** Get staff members by user_ids (e.g. user_id, agency_id, company_owner_id). */
export async function getStaffMembersByUserIds(
  supabase: Supabase,
  userIds: string[],
  select = 'user_id, agency_id, company_owner_id'
) {
  if (userIds.length === 0) return { data: [], error: null }
  return supabase.from('staff_members').select(select).in('user_id', userIds)
}

/** Get staff members with agency_id not null and status active. */
export async function getStaffMembersWithAgencyActive(supabase: Supabase) {
  return supabase
    .from('staff_members')
    .select('*')
    .not('agency_id', 'is', null)
    .eq('status', 'active')
}

/** Get first admin user id (for client messages adminUserId). */
export async function getFirstAdminUserId(supabase: Supabase) {
  return supabase
    .from('user_profiles')
    .select('id')
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
}

/** Get all staff_roles (for caregiver dashboard). */
export async function getStaffRoles(supabase: Supabase) {
  return supabase.from('staff_roles').select('*')
}
