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

  const { data: staffLicensesData } = await q.getStaffLicensesByStaffMemberIds(supabase, [staffId])
  const allStaffLicenses = (staffLicensesData ?? []).map((license: any) => ({
    id: license.id,
    staff_member_id: license.staff_member_id,
    license_type: license.license_type,
    license_number: license.license_number || 'N/A',
    state: license.state,
    status: license.status,
    expiry_date: license.expiry_date,
    days_until_expiry: license.days_until_expiry,
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

