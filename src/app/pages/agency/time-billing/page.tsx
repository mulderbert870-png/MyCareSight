import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import DashboardLayout from '@/components/DashboardLayout'
import TimeBillingContent from '@/components/TimeBillingContent'
import { fetchTimeBillingRows } from '@/lib/time-billing-dashboard'

export default async function TimeBillingPage() {
  const session = await getSession()
  if (!session) redirect('/pages/auth/login')

  const supabase = await createClient()
  const { data: profile } = await q.getUserProfileFull(supabase, session.user.id)
  if (profile?.role === 'admin') redirect('/pages/admin')
  if (profile?.role === 'expert') redirect('/pages/expert/clients')

  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, session.user.id)
  const dashboard = await fetchTimeBillingRows(supabase)

  return (
    <DashboardLayout user={session.user} profile={profile} unreadNotifications={unreadNotifications ?? 0}>
      <TimeBillingContent rows={dashboard.rows} loadError={dashboard.error} />
    </DashboardLayout>
  )
}
