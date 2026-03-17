'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/pages/auth/login')
}

/**
 * Check if an email exists in the app (user_profiles).
 * Used before sending password reset so we can show a clear message when the email is not registered.
 */
export async function checkEmailExistsForReset(email: string): Promise<{ exists: boolean; error?: string }> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('user_profiles')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle()
    if (error) {
      return { exists: false, error: 'Unable to verify email. Please try again.' }
    }
    return { exists: !!data }
  } catch {
    return { exists: false, error: 'Unable to verify email. Please try again.' }
  }
}


