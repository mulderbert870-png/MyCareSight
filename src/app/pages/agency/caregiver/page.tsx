import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import DashboardLayout from '@/components/DashboardLayout'
import StaffManagementClient from '@/components/StaffManagementClient'
import { resolveEffectiveCompanyOwnerUserId } from '@/lib/agency-scope'

export default async function StaffPage() {
  const session = await getSession()
  if (!session) redirect('/pages/auth/login')

  const supabase = await createClient()
  const { data: profile } = await q.getUserProfileFull(supabase, session.user.id)
  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, session.user.id)
  const effectiveOwnerId = await resolveEffectiveCompanyOwnerUserId(supabase, profile, session.user.id)
  const { data: client } = effectiveOwnerId
    ? await q.getClientByCompanyOwnerIdWithAgency(supabase, effectiveOwnerId)
    : { data: null }

  const { data: staffMembersData } = client?.agency_id
    ? await q.getStaffMembersByAgencyId(supabase, client.agency_id)
    : client?.id
      ? await q.getStaffMembersByCompanyOwnerId(supabase, client.id)
    : { data: [] }
  const staffMembers = staffMembersData ?? []

  const { data: staffRolesData } = await q.getStaffRoles(supabase)
  const staffRoleNames = (staffRolesData ?? []).map((role: { name?: string }) => role.name).filter(Boolean) as string[]

  const staffMemberIds = staffMembers.map((s) => s.id)

  const { data: openPayRates } =
    staffMemberIds.length > 0
      ? await supabase
          .from('caregiver_pay_rates')
          .select('caregiver_member_id, pay_rate, service_type')
          .in('caregiver_member_id', staffMemberIds)
          .is('effective_end', null)
      : { data: [] as { caregiver_member_id: string; pay_rate: number; service_type: string | null }[] }

  const currentPayRateByCaregiverId = new Map<string, number>()
  const openRows = openPayRates ?? []
  for (const row of openRows) {
    const id = row.caregiver_member_id as string
    if (currentPayRateByCaregiverId.has(id)) continue
    if (row.service_type == null) {
      currentPayRateByCaregiverId.set(id, Number(row.pay_rate))
    }
  }
  for (const row of openRows) {
    const id = row.caregiver_member_id as string
    if (!currentPayRateByCaregiverId.has(id)) {
      currentPayRateByCaregiverId.set(id, Number(row.pay_rate))
    }
  }

  const { data: allStaffLicensesData } = staffMemberIds.length > 0
    ? await q.getStaffLicensesByStaffMemberIds(supabase, staffMemberIds)
    : { data: [] }

  const allStaffLicenses =
    allStaffLicensesData?.map((license) => ({
      id: license.id,
      caregiver_member_id: license.caregiver_member_id,
      license_type: license.license_type,
      license_number: license.license_number || 'N/A',
      state: license.state,
      status: license.status,
      expiry_date: license.expiry_date,
      days_until_expiry: license.days_until_expiry,
    })) || []
  const licensesByStaff = allStaffLicenses.reduce(
    (acc: Record<string, typeof allStaffLicenses>, license) => {
      const sid = license.caregiver_member_id
      if (!acc[sid]) acc[sid] = []
      acc[sid].push(license)
      return acc
    },
    {}
  )


  // Calculate statistics
  const totalStaff = staffMembers?.length || 0
  const activeStaff = staffMembers?.filter(s => s.status === 'active').length || 0
  
  const today = new Date()
  const expiringLicenses = allStaffLicenses?.filter(sl => {
    if (sl.days_until_expiry) {
      return sl.days_until_expiry <= 30 && sl.days_until_expiry > 0
    }
    return false
  }).length || 0

  // Get staff with expiring licenses count
  const staffWithExpiringLicenses =
    staffMembers?.map((staff) => {
      const licenses = licensesByStaff[staff.id] || []
      const expiringCount = licenses.filter((l) => {
        if (l.days_until_expiry) {
          return l.days_until_expiry <= 30 && l.days_until_expiry > 0
        }
        return false
      }).length
      const pr = currentPayRateByCaregiverId.get(staff.id)
      const currentPayRate = pr !== undefined ? pr : null
      return { ...staff, expiringLicensesCount: expiringCount, currentPayRate }
    }) || []

  return (
    <DashboardLayout user={session.user} profile={profile} unreadNotifications={unreadNotifications || 0}>
      <StaffManagementClient
        staffMembers={staffMembers || []}
        licensesByStaff={licensesByStaff}
        totalStaff={totalStaff}
        activeStaff={activeStaff}
        expiringLicenses={expiringLicenses}
        staffWithExpiringLicenses={staffWithExpiringLicenses}
        staffRoleNames={staffRoleNames}
      />
    </DashboardLayout>
  )
}


