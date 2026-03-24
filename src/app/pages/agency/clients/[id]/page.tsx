import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import DashboardLayout from '@/components/DashboardLayout'
import ClientDetailContent from '@/components/ClientDetailContent'
import { resolveEffectiveCompanyOwnerUserId } from '@/lib/agency-scope'

export default async function ClientDetailPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()

  if (!session) {
    redirect('/pages/auth/login')
  }

  const { id } = await params
  const supabase = await createClient()

  const { data: profile } = await q.getUserProfileFull(supabase, session.user.id)
  if (profile?.role === 'admin') redirect('/pages/admin')
  if (profile?.role === 'expert') redirect('/pages/expert/clients')

  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, session.user.id)
  const effectiveOwnerId = await resolveEffectiveCompanyOwnerUserId(supabase, profile, session.user.id)
  const { data: clientContext } = effectiveOwnerId
    ? await q.getClientByCompanyOwnerIdWithAgency(supabase, effectiveOwnerId)
    : { data: null }

  const { data: client } = clientContext?.agency_id
    ? await q.getPatientByIdAndAgencyId(supabase, id, clientContext.agency_id)
    : effectiveOwnerId
      ? await q.getPatientByIdAndOwnerId(supabase, id, effectiveOwnerId)
      : { data: null }

  


  if (!client) {
    redirect('/pages/agency/clients')
  }

  const { data: allClients } = clientContext?.agency_id
    ? await q.getPatientsByAgencyIdMinimal(supabase, clientContext.agency_id)
    : effectiveOwnerId
      ? await q.getPatientsByOwnerIdMinimal(supabase, effectiveOwnerId)
      : { data: [] }
  let representativesList: Awaited<ReturnType<typeof q.getRepresentativesByPatientId>>['data'] = []
  try {
    const res = await q.getRepresentativesByPatientId(supabase, id)
    representativesList = res.data ?? []
  } catch {
    representativesList = []
  }

  let caregiverRequirements: Awaited<ReturnType<typeof q.getCaregiverRequirementsByPatientId>>['data'] = null
  try {
    const res = await q.getCaregiverRequirementsByPatientId(supabase, id)
    caregiverRequirements = res.data ?? null
  } catch {
    caregiverRequirements = null
  }

  let incidentsList: Awaited<ReturnType<typeof q.getIncidentsByPatientId>>['data'] = []
  try {
    const res = await q.getIncidentsByPatientId(supabase, id)
    incidentsList = res.data ?? []
  } catch {
    incidentsList = []
  }

  let adlsList: Awaited<ReturnType<typeof q.getAdlsByPatientId>>['data'] = []
  let adlSchedulesList: Awaited<ReturnType<typeof q.getPatientAdlDaySchedulesByPatientId>>['data'] = []
  try {
    const [adlsRes, schedulesRes] = await Promise.all([
      q.getAdlsByPatientId(supabase, id),
      q.getPatientAdlDaySchedulesByPatientId(supabase, id),
    ])
    adlsList = adlsRes.data ?? []
    adlSchedulesList = schedulesRes.data ?? []
  } catch {
    adlsList = []
    adlSchedulesList = []
  }

  const agencyClient = clientContext ?? null
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
    const res = await q.getPatientContractedHoursByPatientId(supabase, id)
    contractedHoursList = res.data ?? []
  } catch {
    contractedHoursList = []
  }

  return (
    <DashboardLayout
      user={session.user}
      profile={profile}
      unreadNotifications={unreadNotifications ?? 0}
    >
      <ClientDetailContent 
        client={client} 
        allClients={allClients || []}
        representatives={representativesList}
        caregiverRequirements={caregiverRequirements}
        incidents={incidentsList}
        adls={adlsList}
        adlSchedules={adlSchedulesList}
        staff={staffList}
        contractedHours={contractedHoursList}
      />
    </DashboardLayout>
  )
}
