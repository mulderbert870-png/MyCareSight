import { createClient } from '@supabase/supabase-js'

/**
 * Server-only Supabase client using the service_role key.
 * Use this for admin operations (e.g. creating users on behalf of others)
 * so that the current user's session is never overwritten.
 *
 * Never expose this client or the service role key to the browser.
 * Set SUPABASE_SERVICE_ROLE_KEY in your environment (e.g. .env.local).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  console.log("url: ",url)
  console.log("serviceRoleKey: ",serviceRoleKey)
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL. ' +
        'Add SUPABASE_SERVICE_ROLE_KEY to .env.local for server-side admin operations.'
    )
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
