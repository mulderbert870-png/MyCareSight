'use server'

import { getCachedCaregiverSkillCatalog } from '@/lib/server-cache/reference-lists'

/** Server action for client TanStack Query / forms — skill catalog is reference data. */
export async function getCaregiverSkillCatalogAction() {
  return getCachedCaregiverSkillCatalog()
}
