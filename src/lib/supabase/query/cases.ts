import type { Supabase } from '../types'

/** Get all cases ordered by created_at desc. */
export async function getCases(supabase: Supabase) {
  return supabase.from('cases').select('*').order('created_at', { ascending: false })
}

/** Get all cases ordered by started_date desc. */
export async function getCasesOrderedByStartedDate(supabase: Supabase) {
  return supabase.from('cases').select('*').order('started_date', { ascending: false })
}

/** Get case by id. */
export async function getCaseById(supabase: Supabase, caseId: string) {
  return supabase.from('cases').select('*').eq('id', caseId).single()
}

/** Get cases by client_id. */
export async function getCasesByClientId(supabase: Supabase, clientId: string) {
  return supabase.from('cases').select('*').eq('client_id', clientId)
}

/** Get cases by client ids (optional select). */
export async function getCasesByClientIds(
  supabase: Supabase,
  clientIds: string[],
  select = '*'
) {
  if (clientIds.length === 0) return { data: [], error: null }
  return supabase.from('cases').select(select).in('client_id', clientIds)
}
