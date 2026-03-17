import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import ExpertDashboardLayout from '@/components/ExpertDashboardLayout'
import ExpertClientsContent from '@/components/ExpertClientsContent'

export default async function ExpertClientsPage() {
  const session = await getSession()
  if (!session) redirect('/pages/auth/login')
  if (session.profile?.role !== 'expert') redirect('/pages/agency')

  const supabase = await createClient()
  const { data: applicationsData } = await q.getApplicationsByAssignedExpertId(supabase, session.user.id)
  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, session.user.id)

  // Calculate statistics
  const totalApplications = (applicationsData || []).length
  const activeApplications = (applicationsData || []).filter(app => 
    app.status === 'in_progress' || app.status === 'under_review'
  ).length
  const pendingReviews = (applicationsData || []).filter(app => 
    app.status === 'under_review' || app.status === 'needs_revision'
  ).length

  return (
    <ExpertDashboardLayout 
      user={{ id: session.user.id, email: session.user.email }} 
      profile={session.profile}
      unreadNotifications={unreadNotifications || 0}
    >
      <ExpertClientsContent 
        applications={applicationsData || []}
        totalApplications={totalApplications}
        activeApplications={activeApplications}
        pendingReviews={pendingReviews}
      />
    </ExpertDashboardLayout>
  )
}
