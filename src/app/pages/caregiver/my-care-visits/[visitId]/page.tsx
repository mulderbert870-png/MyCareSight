import { redirect, notFound } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import StaffLayout from '@/components/StaffLayout'
import CaregiverVisitExecutionContent from '@/components/CaregiverVisitExecutionContent'
import { getCachedCaregiverVisitExecutionDetail } from '@/lib/server-cache/caregiver-visit-execution-detail'

type PageProps = {
  params: Promise<{ visitId: string }>
}

export default async function CaregiverVisitExecutionPage({ params }: PageProps) {
  const { visitId } = await params
  if (!visitId || visitId === 'null') notFound()

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

  const { data, error } = await getCachedCaregiverVisitExecutionDetail(
    visitId,
    staffMember.id,
    staffMember.agency_id ?? null,
    session.user.id
  )

  if (error || !data) notFound()

  return (
    <StaffLayout user={session.user} profile={profile} unreadNotifications={unreadNotificationsCount ?? 0}>
      <CaregiverVisitExecutionContent initial={data} />
    </StaffLayout>
  )
}
