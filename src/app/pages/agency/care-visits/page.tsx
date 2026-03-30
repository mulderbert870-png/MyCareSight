import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import DashboardLayout from '@/components/DashboardLayout'
import VisitManagementContent from '@/components/VisitManagementContent'
import { fetchVisitAssignmentDashboardData } from '@/lib/visit-assignment-dashboard'
import { fetchAllVisitsDashboardData } from '@/lib/visit-all-visits-dashboard'

export default async function CareVisitsPage() {
  const session = await getSession()

  if (!session) {
    redirect('/pages/auth/login')
  }

  const supabase = await createClient()
  const { data: profile } = await q.getUserProfileFull(supabase, session.user.id)
  if (profile?.role === 'admin') redirect('/pages/admin')
  if (profile?.role === 'expert') redirect('/pages/expert/clients')

  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, session.user.id)

  const dashboard = await fetchVisitAssignmentDashboardData(supabase)
  const allVisits = await fetchAllVisitsDashboardData(supabase)
  const pendingRequestCount = dashboard.visits.reduce((sum, v) => sum + v.requests.length, 0)

  return (
    <DashboardLayout
      user={session.user}
      profile={profile}
      unreadNotifications={unreadNotifications ?? 0}
      careVisitsPendingCount={pendingRequestCount}
    >
      <VisitManagementContent
        visits={dashboard.visits}
        allVisits={allVisits.allVisits}
        allClients={allVisits.allClients}
        allCaregivers={allVisits.allCaregivers}
        resolved={dashboard.resolved}
        approvedTotal={dashboard.approvedTotal}
        declinedTotal={dashboard.declinedTotal}
        loadError={dashboard.error}
      />
    </DashboardLayout>
  )
}
