import type { Supabase } from '../types'

/** Get certifications by user_id, ordered by expiration_date ascending. */
export async function getCertificationsByUserId(supabase: Supabase, userId: string) {
  return supabase
    .from('certifications')
    .select('*')
    .eq('user_id', userId)
    .order('expiration_date', { ascending: true })
}
