import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import DashboardLayout from '@/components/DashboardLayout'
import ClientsContent from '@/components/ClientsContent'
import { resolveEffectiveCompanyOwnerUserId } from '@/lib/agency-scope'

export default async function ClientsPage() {
  const session = await getSession()

  if (!session) {
    redirect('/pages/auth/login')
  }

  const supabase = await createClient()

  const { data: profile } = await q.getUserProfileFull(supabase, session.user.id)
  if (profile?.role === 'admin') redirect('/pages/admin')
  if (profile?.role === 'expert') redirect('/pages/expert/clients')

  const effectiveOwnerId = await resolveEffectiveCompanyOwnerUserId(supabase, profile, session.user.id)
  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, session.user.id)

  const { data: clientContext } = effectiveOwnerId
    ? await q.getClientByCompanyOwnerIdWithAgency(supabase, effectiveOwnerId)
    : { data: null }

  let clients: NonNullable<Awaited<ReturnType<typeof q.getPatientsByAgencyId>>['data']>

  if (clientContext?.agency_id) {
    const patientsResult = await q.getPatientsByAgencyId(supabase, clientContext.agency_id)
    clients = patientsResult.data ?? []
  } else if (effectiveOwnerId) {
    const patientsResult = await q.getPatientsByOwnerId(supabase, effectiveOwnerId)
    clients = patientsResult.data ?? []
  } else {
    clients = []
  }

  return (
    <DashboardLayout
      user={session.user}
      profile={profile}
      unreadNotifications={unreadNotifications ?? 0}
    >
      <ClientsContent clients={clients || []} />
    </DashboardLayout>
  )
}
