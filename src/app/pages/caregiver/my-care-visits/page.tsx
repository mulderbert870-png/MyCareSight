import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import StaffLayout from '@/components/StaffLayout'
import CaregiverMyCareVisitsContent from '@/components/CaregiverMyCareVisitsContent'
import { fetchCaregiverCareVisitsData } from '@/lib/caregiver-care-visits'

export default async function CaregiverMyCareVisitsPage() {
  const session = await getSession()
  if (!session) redirect('/pages/auth/login')

  const supabase = await createClient()
  const { data: profile, error: profileError } = await q.getUserProfileFull(supabase, session.user.id)
  if (profileError || !profile) redirect('/pages/auth/login?error=Unable to load user profile')
  if (profile.role !== 'staff_member') redirect('/pages/auth/login?error=Access denied. Staff member role required.')

  const { data: staffMember, error: staffMemberError } = await q.getStaffMemberByUserId(supabase, session.user.id)
  if (staffMemberError || !staffMember) {
    redirect('/pages/auth/login?error=Staff member record not found. Please contact your administrator.')
  }

  const { count: unreadNotificationsCount } = await q.getUnreadNotificationsCount(supabase, session.user.id)
  const data = await fetchCaregiverCareVisitsData(supabase, staffMember.id, staffMember.agency_id ?? null)

  return (
    <StaffLayout user={session.user} profile={profile} unreadNotifications={unreadNotificationsCount ?? 0}>
      <CaregiverMyCareVisitsContent
        visits={data.visits}
        mineCount={data.mineCount}
        openCount={data.openCount}
        todayCount={data.todayCount}
      />
    </StaffLayout>
  )
}
