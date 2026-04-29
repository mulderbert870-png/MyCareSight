import type { Supabase } from '../types'

type ClientStateRow = {
  id: string
  client_id: string
  state: string
}

/** Get client_states by client_id. */
export async function getClientStatesByClientId(supabase: Supabase, clientId: string) {
  const _supabase = supabase
  const _clientId = clientId
  return { data: [] as ClientStateRow[], error: null }
}

/** Get client_states by client ids. */
export async function getClientStatesByClientIds(supabase: Supabase, clientIds: string[]) {
  const _supabase = supabase
  const _clientIds = clientIds
  return { data: [] as ClientStateRow[], error: null }
}
