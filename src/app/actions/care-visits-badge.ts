'use server'

import { createClient } from '@/lib/supabase/server'
import { getPendingAssignmentRequestCountForBadge } from '@/lib/visit-assignment-dashboard'

/** Sidebar badge: same pending count as Visit Management → Assignment Requests. */
export async function getCareVisitsPendingBadgeCountAction(): Promise<number> {
  const supabase = await createClient()
  const { count } = await getPendingAssignmentRequestCountForBadge(supabase)
  return count
}
