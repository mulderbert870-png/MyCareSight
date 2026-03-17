import type { Supabase } from '../types'

/** RPC: create licensing expert (handles user + licensing_experts row). */
export async function rpcCreateLicensingExpert(
  supabase: Supabase,
  params: {
    p_first_name: string
    p_last_name: string
    p_email: string
    p_password: string
    p_phone?: string | null
    p_expertise?: string | null
    p_role?: string
    p_status?: string
  }
) {
  return supabase.rpc('create_licensing_expert', params)
}

/** Get licensing_expert by id. */
export async function getLicensingExpertById(supabase: Supabase, id: string) {
  return supabase.from('licensing_experts').select('*').eq('id', id).single()
}

/** Update licensing_expert by id. */
export async function updateLicensingExpertById(
  supabase: Supabase,
  id: string,
  data: Record<string, unknown>
) {
  return supabase.from('licensing_experts').update(data).eq('id', id)
}

/** Get all licensing_experts ordered by created_at desc. */
export async function getLicensingExpertsOrdered(supabase: Supabase) {
  return supabase.from('licensing_experts').select('*').order('created_at', { ascending: false })
}

/** Get licensing_experts by user_ids. */
export async function getLicensingExpertsByUserIds(supabase: Supabase, userIds: string[]) {
  if (userIds.length === 0) return { data: [], error: null }
  return supabase.from('licensing_experts').select('*').in('user_id', userIds)
}

/** Get licensing_experts by ids (e.g. id, user_id, first_name, last_name). */
export async function getLicensingExpertsByIds(
  supabase: Supabase,
  ids: string[],
  select = 'id, user_id, first_name, last_name'
) {
  if (ids.length === 0) return { data: [], error: null }
  return supabase.from('licensing_experts').select(select).in('id', ids)
}

/** Get licensing_experts active, ordered by first_name. */
export async function getLicensingExpertsActive(supabase: Supabase) {
  return supabase
    .from('licensing_experts')
    .select('*')
    .eq('status', 'active')
    .order('first_name', { ascending: true })
}

/** Get expert_states by expert_id. */
export async function getExpertStatesByExpertId(supabase: Supabase, expertId: string) {
  return supabase.from('expert_states').select('*').eq('expert_id', expertId)
}

/** Get expert_states by expert ids. */
export async function getExpertStatesByExpertIds(supabase: Supabase, expertIds: string[]) {
  if (expertIds.length === 0) return { data: [], error: null }
  return supabase.from('expert_states').select('*').in('expert_id', expertIds)
}

/** Get licensing_expert by user_id. */
export async function getLicensingExpertByUserId(supabase: Supabase, userId: string) {
  return supabase.from('licensing_experts').select('*').eq('user_id', userId).maybeSingle()
}

/** Get clients by expert_id (user_id), e.g. for expert detail page. */
export async function getClientsByExpertId(supabase: Supabase, expertUserId: string) {
  return supabase
    .from('clients')
    .select('*')
    .eq('expert_id', expertUserId)
    .order('company_name', { ascending: true })
}

/** Get clients by expert ids (e.g. licensing_expert ids for counting). */
export async function getClientsByExpertIds(supabase: Supabase, expertIds: string[]) {
  if (expertIds.length === 0) return { data: [], error: null }
  return supabase.from('clients').select('expert_id').in('expert_id', expertIds)
}
