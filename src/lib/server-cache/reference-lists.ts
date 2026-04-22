import { unstable_cache, unstable_cacheTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import {
  CACHE_TAG_AGENCIES_FOR_BILLING,
  CACHE_TAG_AGENCIES_ID_NAME,
  CACHE_TAG_AGENCIES_ORDERED,
  CACHE_TAG_CAREGIVER_ROLES,
  CACHE_TAG_CAREGIVER_SKILL_CATALOG,
  CACHE_TAG_CERTIFICATION_TYPES,
  CACHE_TAG_LICENSE_TYPES_ACTIVE,
  CACHE_TAG_TASK_CATALOG_NON_SKILLED,
  CACHE_TAG_TASK_CATALOG_SKILLED,
  CACHE_TAG_TASK_CATEGORIES_NON_SKILLED,
  CACHE_TAG_TASK_CATEGORIES_SKILLED,
} from '@/lib/cache-tags'

type ServiceType = 'skilled' | 'non_skilled'
type TaskCategoryItem = { id: string; name: string }
type TaskCatalogItem = { id: string; name: string; categoryId: string; categoryName: string }

const getAgenciesIdNameCached = unstable_cache(
  async () => {
    unstable_cacheTag(CACHE_TAG_AGENCIES_ID_NAME)
    const supabase = await createClient()
    return q.getAgenciesIdName(supabase)
  },
  ['ref-agencies-id-name'],
  { revalidate: 120 }
)

const getAgenciesOrderedCached = unstable_cache(
  async () => {
    unstable_cacheTag(CACHE_TAG_AGENCIES_ORDERED)
    const supabase = await createClient()
    return q.getAgenciesOrdered(supabase)
  },
  ['ref-agencies-ordered'],
  { revalidate: 120 }
)

const getAgenciesForBillingCached = unstable_cache(
  async () => {
    unstable_cacheTag(CACHE_TAG_AGENCIES_FOR_BILLING)
    const supabase = await createClient()
    return q.getAgenciesForBilling(supabase)
  },
  ['ref-agencies-billing'],
  { revalidate: 120 }
)

const getCertificationTypesCached = unstable_cache(
  async () => {
    unstable_cacheTag(CACHE_TAG_CERTIFICATION_TYPES)
    const supabase = await createClient()
    const { data: types, error } = await supabase
      .from('certification_types')
      .select('*')
      .order('certification_type', { ascending: true })
    if (error) return { error: error.message, data: null }
    return { error: null, data: types }
  },
  ['ref-certification-types'],
  { revalidate: 300 }
)

const getStaffRolesCached = unstable_cache(
  async () => {
    unstable_cacheTag(CACHE_TAG_CAREGIVER_ROLES)
    const supabase = await createClient()
    try {
      const { data: roles, error } = await supabase.from('caregiver_roles').select('*').order('name', { ascending: true })
      if (error) {
        if (error.code === '42P01') return { error: null, data: [] }
        return { error: error.message, data: null }
      }
      return { error: null, data: roles || [] }
    } catch {
      return { error: null, data: [] }
    }
  },
  ['ref-caregiver-roles'],
  { revalidate: 300 }
)

async function fetchTasksByServiceType(serviceType: ServiceType): Promise<{
  error: string | null
  data: TaskCatalogItem[] | null
}> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('task_catalog')
    .select('id, name, category_id, task_categories!inner(id, name, service_type)')
    .eq('task_categories.service_type', serviceType)
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return { error: error.message, data: null }
  const normalized = (data ?? [])
    .map((row: Record<string, unknown>) => {
      const category = Array.isArray(row.task_categories) ? row.task_categories[0] : row.task_categories
      const cat = category as { id?: string; name?: string } | null
      return {
        id: String(row.id),
        name: String(row.name ?? '').trim(),
        categoryId: String(row.category_id ?? cat?.id ?? ''),
        categoryName: String(cat?.name ?? '').trim() || 'General',
      } satisfies TaskCatalogItem
    })
    .filter((row) => row.id && row.name)

  return { error: null, data: normalized }
}

async function fetchTaskCategoriesByServiceType(serviceType: ServiceType): Promise<{
  error: string | null
  data: TaskCategoryItem[] | null
}> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('task_categories')
    .select('id, name')
    .eq('service_type', serviceType)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return { error: error.message, data: null }
  const normalized = (data ?? [])
    .map((row: Record<string, unknown>) => ({
      id: String(row.id),
      name: String(row.name ?? '').trim(),
    }))
    .filter((row) => row.id && row.name)

  return { error: null, data: normalized }
}

const getSkilledTasksCached = unstable_cache(
  async () => {
    unstable_cacheTag(CACHE_TAG_TASK_CATALOG_SKILLED)
    return fetchTasksByServiceType('skilled')
  },
  ['ref-task-catalog-skilled'],
  { revalidate: 180 }
)

const getNonSkilledTasksCached = unstable_cache(
  async () => {
    unstable_cacheTag(CACHE_TAG_TASK_CATALOG_NON_SKILLED)
    return fetchTasksByServiceType('non_skilled')
  },
  ['ref-task-catalog-non-skilled'],
  { revalidate: 180 }
)

const getSkilledTaskCategoriesCached = unstable_cache(
  async () => {
    unstable_cacheTag(CACHE_TAG_TASK_CATEGORIES_SKILLED)
    return fetchTaskCategoriesByServiceType('skilled')
  },
  ['ref-task-categories-skilled'],
  { revalidate: 180 }
)

const getNonSkilledTaskCategoriesCached = unstable_cache(
  async () => {
    unstable_cacheTag(CACHE_TAG_TASK_CATEGORIES_NON_SKILLED)
    return fetchTaskCategoriesByServiceType('non_skilled')
  },
  ['ref-task-categories-non-skilled'],
  { revalidate: 180 }
)

const CONFIG_LICENSE_TYPES_SELECT =
  'id, name, state, renewal_period_display, cost_display, service_fee_display, processing_time_display'

const getLicenseTypesActiveConfigCached = unstable_cache(
  async () => {
    unstable_cacheTag(CACHE_TAG_LICENSE_TYPES_ACTIVE)
    const supabase = await createClient()
    return q.getLicenseTypesActive(supabase, CONFIG_LICENSE_TYPES_SELECT)
  },
  ['ref-license-types-active', CONFIG_LICENSE_TYPES_SELECT],
  { revalidate: 300 }
)

const getLicenseTypesActiveBillingCached = unstable_cache(
  async () => {
    unstable_cacheTag(CACHE_TAG_LICENSE_TYPES_ACTIVE)
    const supabase = await createClient()
    return q.getLicenseTypesActive(supabase)
  },
  ['ref-license-types-active-billing'],
  { revalidate: 300 }
)

const getCaregiverSkillCatalogCached = unstable_cache(
  async () => {
    unstable_cacheTag(CACHE_TAG_CAREGIVER_SKILL_CATALOG)
    const supabase = await createClient()
    return q.getCaregiverSkillCatalogFromTaskRequirements(supabase)
  },
  ['ref-caregiver-skill-catalog'],
  { revalidate: 180 }
)

export function getCachedAgenciesIdName() {
  return getAgenciesIdNameCached()
}

export function getCachedAgenciesOrdered() {
  return getAgenciesOrderedCached()
}

export function getCachedAgenciesForBilling() {
  return getAgenciesForBillingCached()
}

export function getCachedCertificationTypes() {
  return getCertificationTypesCached()
}

export function getCachedStaffRoles() {
  return getStaffRolesCached()
}

export function getCachedSkilledTasks() {
  return getSkilledTasksCached()
}

export function getCachedNonSkilledTasks() {
  return getNonSkilledTasksCached()
}

export function getCachedSkilledTaskCategories() {
  return getSkilledTaskCategoriesCached()
}

export function getCachedNonSkilledTaskCategories() {
  return getNonSkilledTaskCategoriesCached()
}

export function getCachedLicenseTypesForConfiguration() {
  return getLicenseTypesActiveConfigCached()
}

export function getCachedLicenseTypesForBilling() {
  return getLicenseTypesActiveBillingCached()
}

export function getCachedCaregiverSkillCatalog() {
  return getCaregiverSkillCatalogCached()
}
