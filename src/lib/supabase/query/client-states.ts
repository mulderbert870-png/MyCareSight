import type { Supabase } from '../types'

/** Get client_states by client_id. */
export async function getClientStatesByClientId(supabase: Supabase, clientId: string) {
  return supabase.from('client_states').select('*').eq('client_id', clientId)
}

/** Get client_states by client ids. */
export async function getClientStatesByClientIds(supabase: Supabase, clientIds: string[]) {
  if (clientIds.length === 0) return { data: [], error: null }
  return supabase.from('client_states').select('*').in('client_id', clientIds)
}
