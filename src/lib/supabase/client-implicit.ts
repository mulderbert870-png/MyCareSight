import { createClient } from '@supabase/supabase-js'

/**
 * Browser-only Supabase client using implicit flow (tokens in URL fragment).
 * Use this for password reset so the recovery link works when opened in a
 * different browser/device (no PKCE code_verifier required).
 */
export function createImplicitClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: 'implicit',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    }
  )
}
