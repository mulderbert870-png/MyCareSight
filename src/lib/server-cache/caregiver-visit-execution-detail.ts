import { unstable_cache, unstable_cacheTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { fetchCaregiverVisitExecutionDetail } from '@/lib/caregiver-visit-execution'
import { caregiverVisitExecutionTag, CACHE_TAG_CAREGIVER_VISIT_EXECUTION } from '@/lib/cache-tags'

const getCaregiverVisitExecutionDetailCached = unstable_cache(
  async (visitId: string, staffMemberId: string, agencyId: string | null, viewerUserId: string) => {
    unstable_cacheTag(CACHE_TAG_CAREGIVER_VISIT_EXECUTION, caregiverVisitExecutionTag(visitId))
    const supabase = await createClient()
    return fetchCaregiverVisitExecutionDetail(supabase, visitId, staffMemberId, agencyId)
  },
  ['caregiver-visit-execution-detail'],
  { revalidate: 15 }
)

export function getCachedCaregiverVisitExecutionDetail(
  visitId: string,
  staffMemberId: string,
  agencyId: string | null,
  viewerUserId: string
) {
  return getCaregiverVisitExecutionDetailCached(visitId, staffMemberId, agencyId, viewerUserId)
}
