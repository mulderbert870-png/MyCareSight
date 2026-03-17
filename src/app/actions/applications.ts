'use server'

import { createClient } from '@/lib/supabase/server'
import { getApplicationForClose, closeApplicationUpdate } from '@/lib/supabase/query'

/**
 * Close an application. Allowed when progress is 100%.
 * Expert and admin can close from the application detail page.
 */
export async function closeApplication(applicationId: string): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { data: app, error: fetchError } = await getApplicationForClose(supabase, applicationId)

  if (fetchError || !app) {
    return { error: 'Application not found' }
  }

  if (app.status === 'closed') {
    return { error: null } // already closed
  }

  const progress = app.progress_percentage ?? 0
  if (progress < 100) {
    return { error: 'Application can only be closed when progress is 100%' }
  }

  const { error: updateError } = await closeApplicationUpdate(supabase, applicationId)

  if (updateError) {
    return { error: updateError.message }
  }
  return { error: null }
}
