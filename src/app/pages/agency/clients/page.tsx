import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import DashboardLayout from '@/components/DashboardLayout'
import ClientsContent from '@/components/ClientsContent'
import { getEffectiveCompanyOwnerUserId } from '@/lib/agency-scope'

export default async function ClientsPage() {
  const session = await getSession()

  if (!session) {
    redirect('/pages/auth/login')
  }

  const supabase = await createClient()

  const { data: profile } = await q.getUserProfileFull(supabase, session.user.id)
  if (profile?.role === 'admin') redirect('/pages/admin')
  if (profile?.role === 'expert') redirect('/pages/expert/clients')

  const effectiveOwnerId = getEffectiveCompanyOwnerUserId(profile, session.user.id)
  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, session.user.id)
  console.log('[agency/clients] scope', {
    sessionUserId: session.user.id,
    role: profile?.role ?? null,
    effectiveOwnerId,
  })

  let patientsResult: Awaited<ReturnType<typeof q.getPatientsByAgencyId>> | { data: null } = { data: null }
  if (effectiveOwnerId) {
    const { data: clientContext } = await q.getClientByCompanyOwnerIdWithAgency(supabase, effectiveOwnerId)
    console.log('[agency/clients] clientContext', {
      effectiveOwnerId,
      clientId: clientContext?.id ?? null,
      agencyId: clientContext?.agency_id ?? null,
    })
    if (clientContext?.agency_id) {
      patientsResult = await q.getPatientsByAgencyId(supabase, clientContext.agency_id)
      console.log('[agency/clients] patientsByAgency', {
        agencyId: clientContext.agency_id,
        count: patientsResult.data?.length ?? 0,
        patientIds: (patientsResult.data ?? []).map((p: { id: string }) => p.id),
      })
    }
  }
  const clients = patientsResult.data ?? []

  return (
    <DashboardLayout
      user={session.user}
      profile={profile}
      unreadNotifications={unreadNotifications ?? 0}
    >
      <ClientsContent clients={clients} />
    </DashboardLayout>
  )
}
