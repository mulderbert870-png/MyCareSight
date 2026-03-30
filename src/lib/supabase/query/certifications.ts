import type { Supabase } from '../types'

/** Credentials for a user (caregiver_credentials), ordered by expiration_date ascending. */
export async function getCertificationsByUserId(supabase: Supabase, userId: string) {
  return supabase
    .from('caregiver_credentials')
    .select('*')
    .eq('user_id', userId)
    .order('expiration_date', { ascending: true })
}
