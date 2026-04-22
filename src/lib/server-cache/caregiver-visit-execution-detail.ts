import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchCaregiverVisitExecutionDetail } from '@/lib/caregiver-visit-execution'
import { CACHE_TAG_CAREGIVER_VISIT_EXECUTION } from '@/lib/cache-tags'

const getCaregiverVisitExecutionDetailCached = unstable_cache(
  async (visitId: string, staffMemberId: string, agencyId: string | null, viewerUserId: string) => {
    const supabase = createAdminClient()
    return fetchCaregiverVisitExecutionDetail(supabase, visitId, staffMemberId, agencyId)
  },
  ['caregiver-visit-execution-detail'],
  { revalidate: 15, tags: [CACHE_TAG_CAREGIVER_VISIT_EXECUTION] }
)

export function getCachedCaregiverVisitExecutionDetail(
  visitId: string,
  staffMemberId: string,
  agencyId: string | null,
  viewerUserId: string
) {
  return getCaregiverVisitExecutionDetailCached(visitId, staffMemberId, agencyId, viewerUserId)
}
