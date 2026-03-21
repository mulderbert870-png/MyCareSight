import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import DashboardLayout from '@/components/DashboardLayout'
import CaregiverProfileContent from '@/components/CaregiverProfileContent'

export default async function CaregiverProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ clientId?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/pages/auth/login')

  const { id: staffId } = await params
  const { clientId } = await searchParams

  const supabase = await createClient()

  const { data: profile } = await q.getUserProfileFull(supabase, session.user.id)
  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, session.user.id)

  const { data: client } = await q.getClientByCompanyOwnerId(supabase, session.user.id)
  if (!client?.id) redirect('/pages/agency/caregiver')

  const { data: staff, error: staffError } = await supabase
    .from('staff_members')
    .select('*')
    .eq('company_owner_id', client.id)
    .eq('id', staffId)
    .maybeSingle()

  if (staffError || !staff) redirect('/pages/agency/caregiver')

  const { data: applicationsData } = await q.getApplicationsByStaffMemberIdsAll(supabase, [staffId])
  const allStaffLicenses = (applicationsData ?? []).map((app: any) => ({
    id: app.id,
    staff_member_id: app.staff_member_id,
    license_type: app.application_name,
    license_number: app.license_number || 'N/A',
    state: app.state,
    status: app.status === 'approved' ? 'active' : app.status === 'rejected' ? 'expired' : 'active',
    expiry_date: app.expiry_date,
    days_until_expiry: app.days_until_expiry,
  }))

  return (
    <DashboardLayout user={session.user} profile={profile} unreadNotifications={unreadNotifications || 0}>
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-xl shadow-md border border-gray-100 p-6 mt-6">
          <CaregiverProfileContent
            staff={staff as any}
            licenses={allStaffLicenses as any}
            backHref={clientId ? `/pages/agency/clients/${clientId}` : '/pages/agency/clients'}
          />
        </div>
      </div>
    </DashboardLayout>
  )
}

