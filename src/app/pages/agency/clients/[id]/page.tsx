import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import DashboardLayout from '@/components/DashboardLayout'
import ClientDetailContent from '@/components/ClientDetailContent'

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
  const { data: client } = await q.getPatientByIdAndOwnerId(supabase, id, session.user.id)

  if (!client) {
    redirect('/pages/agency/clients')
  }

  const { data: allClients } = await q.getPatientsByOwnerIdMinimal(supabase, session.user.id)
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
      />
    </DashboardLayout>
  )
}
