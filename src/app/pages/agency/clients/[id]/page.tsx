import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import DashboardLayout from '@/components/DashboardLayout'
import ClientDetailContent from '@/components/ClientDetailContent'
import { getEffectiveCompanyOwnerUserId } from '@/lib/agency-scope'

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

  const effectiveOwnerId = getEffectiveCompanyOwnerUserId(profile, session.user.id)
  if (!effectiveOwnerId) {
    redirect('/pages/agency/clients')
  }
  console.log('[agency/clients/[id]] scope', {
    sessionUserId: session.user.id,
    role: profile?.role ?? null,
    effectiveOwnerId,
    patientId: id,
  })

  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, session.user.id)

  const { data: viewerClient } = await q.getClientByCompanyOwnerIdWithAgency(supabase, effectiveOwnerId)
  console.log('[agency/clients/[id]] viewerClient', {
    effectiveOwnerId,
    clientId: viewerClient?.id ?? null,
    agencyId: viewerClient?.agency_id ?? null,
  })
  if (!viewerClient?.agency_id) {
    redirect('/pages/agency/clients')
  }
  const { data: client } = await q.getPatientByIdAndAgencyId(supabase, id, viewerClient.agency_id)
  console.log('[agency/clients/[id]] patientByAgency', {
    agencyId: viewerClient.agency_id,
    found: Boolean(client),
    foundPatientId: client?.id ?? null,
  })

  


  if (!client) {
    redirect('/pages/agency/clients')
  }

  const { data: allClients } = await q.getPatientsByAgencyIdMinimal(supabase, viewerClient.agency_id)
  console.log('[agency/clients/[id]] allPatientsByAgency', {
    agencyId: viewerClient.agency_id,
    count: allClients?.length ?? 0,
    patientIds: (allClients ?? []).map((c: { id: string }) => c.id),
  })
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

  const { data: staffListData } = await q.getStaffMembersByAgencyId(supabase, viewerClient.agency_id, {
    status: 'active',
  })
  const staffList = staffListData ?? []
  console.log('[agency/clients/[id]] staffByAgency', {
    agencyId: viewerClient.agency_id,
    count: staffList.length,
    staffIds: staffList.map((s: { id: string }) => s.id),
  })

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
