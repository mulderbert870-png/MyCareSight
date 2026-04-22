import { unstable_cache, unstable_cacheTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import { resolveEffectiveCompanyOwnerUserId } from '@/lib/agency-scope'
import { agencyPatientDetailTag, CACHE_TAG_AGENCY_CLIENT_DETAIL } from '@/lib/cache-tags'

async function loadAgencyClientDetailBundleUncached(patientId: string, viewerUserId: string) {
  const supabase = await createClient()

  const { data: profile } = await q.getUserProfileFull(supabase, viewerUserId)
  if (!profile) return null

  const effectiveOwnerId = await resolveEffectiveCompanyOwnerUserId(supabase, profile, viewerUserId)
  const { data: clientContext } = effectiveOwnerId
    ? await q.getClientByCompanyOwnerIdWithAgency(supabase, effectiveOwnerId)
    : { data: null }

  const { data: client } = clientContext?.agency_id
    ? await q.getPatientByIdAndAgencyId(supabase, patientId, clientContext.agency_id)
    : effectiveOwnerId
      ? await q.getPatientByIdAndOwnerId(supabase, patientId, effectiveOwnerId)
      : { data: null }

  if (!client) return null

  const agencyClient = clientContext ?? null

  const { data: allClients } = clientContext?.agency_id
    ? await q.getPatientsByAgencyIdMinimal(supabase, clientContext.agency_id)
    : effectiveOwnerId
      ? await q.getPatientsByOwnerIdMinimal(supabase, effectiveOwnerId)
      : { data: [] }

  let representativesList: Awaited<ReturnType<typeof q.getRepresentativesByPatientId>>['data'] = []
  try {
    const res = await q.getRepresentativesByPatientId(supabase, patientId)
    representativesList = res.data ?? []
  } catch {
    representativesList = []
  }

  let caregiverRequirements: Awaited<ReturnType<typeof q.getCaregiverRequirementsByPatientId>>['data'] = null
  try {
    const res = await q.getCaregiverRequirementsByPatientId(supabase, patientId)
    caregiverRequirements = res.data ?? null
  } catch {
    caregiverRequirements = null
  }

  let incidentsList: Awaited<ReturnType<typeof q.getIncidentsByPatientId>>['data'] = []
  try {
    const res = await q.getIncidentsByPatientId(supabase, patientId)
    incidentsList = res.data ?? []
  } catch {
    incidentsList = []
  }

  let adlsList: Awaited<ReturnType<typeof q.getAdlsByPatientId>>['data'] = []
  let adlSchedulesList: Awaited<ReturnType<typeof q.getPatientAdlDaySchedulesByPatientId>>['data'] = []
  try {
    const [adlsRes, schedulesRes] = await Promise.all([
      q.getAdlsByPatientId(supabase, patientId),
      q.getPatientAdlDaySchedulesByPatientId(supabase, patientId),
    ])
    adlsList = adlsRes.data ?? []
    adlSchedulesList = schedulesRes.data ?? []
  } catch {
    adlsList = []
    adlSchedulesList = []
  }

  let staffList: Awaited<ReturnType<typeof q.getStaffMembersByCompanyOwnerId>>['data'] = []
  if (agencyClient?.agency_id) {
    const res = await q.getStaffMembersByAgencyId(supabase, agencyClient.agency_id, { status: 'active' })
    staffList = res.data ?? []
  } else if (agencyClient?.id) {
    const res = await q.getStaffMembersByCompanyOwnerId(supabase, agencyClient.id, { status: 'active' })
    staffList = res.data ?? []
  }

  let contractedHoursList: Awaited<ReturnType<typeof q.getPatientContractedHoursByPatientId>>['data'] = []
  try {
    const res = await q.getPatientContractedHoursByPatientId(supabase, patientId)
    contractedHoursList = res.data ?? []
  } catch {
    contractedHoursList = []
  }

  let serviceContracts: Awaited<ReturnType<typeof q.getPatientServiceContractsByPatientId>>['data'] = []
  try {
    const res = await q.getPatientServiceContractsByPatientId(supabase, patientId)
    serviceContracts = res.data ?? []
  } catch {
    serviceContracts = []
  }

  let skilledCarePlanTasks: Awaited<ReturnType<typeof q.getPatientSkilledCarePlanTasks>>['data'] = []
  let skilledSchedulesList: Awaited<ReturnType<typeof q.getPatientSkilledDaySchedulesByPatientId>>['data'] = []
  try {
    const [tasksRes, schedRes] = await Promise.all([
      q.getPatientSkilledCarePlanTasks(supabase, patientId),
      q.getPatientSkilledDaySchedulesByPatientId(supabase, patientId),
    ])
    skilledCarePlanTasks = tasksRes.data ?? []
    skilledSchedulesList = schedRes.data ?? []
  } catch {
    skilledCarePlanTasks = []
    skilledSchedulesList = []
  }

  return {
    client,
    allClients: allClients ?? [],
    representativesList,
    caregiverRequirements,
    incidentsList,
    adlsList,
    adlSchedulesList,
    staffList,
    contractedHoursList,
    serviceContracts,
    skilledCarePlanTasks,
    skilledSchedulesList,
  }
}

const getAgencyClientDetailBundleCached = unstable_cache(
  async (patientId: string, viewerUserId: string) => {
    unstable_cacheTag(CACHE_TAG_AGENCY_CLIENT_DETAIL, agencyPatientDetailTag(patientId))
    return loadAgencyClientDetailBundleUncached(patientId, viewerUserId)
  },
  ['agency-client-detail-bundle'],
  { revalidate: 45 }
)

/**
 * Cached patient detail payload for agency client page. Scoped by `viewerUserId` + `patientId`.
 * Invalidate with `revalidateTag(agencyPatientDetailTag(patientId))` after writes.
 */
export function getCachedAgencyClientDetailBundle(patientId: string, viewerUserId: string) {
  return getAgencyClientDetailBundleCached(patientId, viewerUserId)
}
