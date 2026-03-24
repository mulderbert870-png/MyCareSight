import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import DashboardLayout from '@/components/DashboardLayout'
import CaregiverProfileContent from '@/components/CaregiverProfileContent'
import { resolveEffectiveCompanyOwnerUserId } from '@/lib/agency-scope'

export default async function CaregiverProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ clientId?: string; embed?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/pages/auth/login')

  const { id: staffId } = await params
  const { clientId, embed } = await searchParams
  const isEmbed = embed === '1' || embed === 'true'

  const supabase = await createClient()
  const { data: profile } = await q.getUserProfileFull(supabase, session.user.id)
  const effectiveOwnerId = await resolveEffectiveCompanyOwnerUserId(supabase, profile, session.user.id)
  const { data: client } = effectiveOwnerId
    ? await q.getClientByCompanyOwnerIdWithAgency(supabase, effectiveOwnerId)
    : { data: null }
  if (!client?.id) redirect('/pages/agency/caregiver')

  const { data: staff, error: staffError } = client.agency_id
    ? await q.getStaffMemberByIdAndAgencyId(supabase, staffId, client.agency_id)
    : await q.getStaffMemberByIdWithAgencyOrCompanyOwner(supabase, staffId, client.id, null)

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

  const profileCard = (
    <div className="max-w-4xl mx-auto mt-20">
      <div
        className={`bg-white rounded-xl shadow-md border border-gray-100 p-6 ${isEmbed ? '' : 'mt-6'}`}
      >
        <CaregiverProfileContent
          staff={staff as any}
          licenses={allStaffLicenses as any}
          backHref={
            isEmbed
              ? undefined
              : clientId
                ? `/pages/agency/clients/${clientId}`
                : '/pages/agency/clients'
          }
        />
      </div>
    </div>
  )

  if (isEmbed) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 md:p-6 print:bg-white print:p-0">
        <div className="print:shadow-none print:rounded-none">{profileCard}</div>
      </div>
    )
  }

  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, session.user.id)

  return (
    <DashboardLayout user={session.user} profile={profile} unreadNotifications={unreadNotifications || 0}>
      {profileCard}
    </DashboardLayout>
  )
}

