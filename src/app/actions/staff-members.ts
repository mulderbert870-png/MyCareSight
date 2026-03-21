'use server'

import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import type { PatientDocument } from '@/lib/supabase/query/patients'

export async function updateStaffMemberDocumentsAction(
  staffMemberId: string,
  documents: PatientDocument[]
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'You must be logged in to update documents' }
  }

  const { data, error } = await q.updateStaffMemberDocuments(supabase, staffMemberId, documents)
  if (error || !data) {
    return { error: error?.message ?? 'Update failed' }
  }
  return { error: null }
}
