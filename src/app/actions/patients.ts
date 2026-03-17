'use server'

import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import type { PatientDocument } from '@/lib/supabase/query/patients'

/**
 * Update patient documents (JSONB) from the server. Use after uploading files to storage from the client.
 * Ensures the update runs with the same session that loaded the page.
 */
export async function updatePatientDocumentsAction(
  patientId: string,
  documents: PatientDocument[]
): Promise<{ error: string | null }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'You must be logged in to update documents' }
  }

  const { data, error } = await q.updatePatientDocuments(supabase, patientId, documents)
  if (error || !data) {
    return { error: error?.message ?? 'Update failed' }
  }
  return { error: null }
}
