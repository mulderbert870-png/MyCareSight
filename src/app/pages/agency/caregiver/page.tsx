import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import DashboardLayout from '@/components/DashboardLayout'
import StaffManagementClient from '@/components/StaffManagementClient'
import { getEffectiveCompanyOwnerUserId } from '@/lib/agency-scope'

export default async function StaffPage() {
  const session = await getSession()
  if (!session) redirect('/pages/auth/login')

  const supabase = await createClient()
  const { data: profile } = await q.getUserProfileFull(supabase, session.user.id)
  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, session.user.id)
  const effectiveOwnerId = getEffectiveCompanyOwnerUserId(profile, session.user.id)
  console.log('[agency/caregiver] scope', {
    sessionUserId: session.user.id,
    role: profile?.role ?? null,
    effectiveOwnerId,
  })
  const { data: client } = effectiveOwnerId
    ? await q.getClientByCompanyOwnerIdWithAgency(supabase, effectiveOwnerId)
    : { data: null }
  console.log('[agency/caregiver] clientContext', {
    effectiveOwnerId,
    clientId: client?.id ?? null,
    agencyId: client?.agency_id ?? null,
  })

  const { data: staffMembersData } = client?.agency_id
    ? await q.getStaffMembersByAgencyId(supabase, client.agency_id)
    : { data: [] }
  const staffMembers = staffMembersData ?? []
  console.log('[agency/caregiver] staffByAgency', {
    agencyId: client?.agency_id ?? null,
    count: staffMembers.length,
    staffIds: staffMembers.map((s: { id: string }) => s.id),
  })

  const { data: staffRolesData } = await q.getStaffRoles(supabase)
  const staffRoleNames = (staffRolesData ?? []).map((role: { name?: string }) => role.name).filter(Boolean) as string[]

  const staffMemberIds = staffMembers.map(s => s.id)
  const { data: allStaffLicensesData } = staffMemberIds.length > 0
    ? await q.getApplicationsByStaffMemberIdsAll(supabase, staffMemberIds)
    : { data: [] }

  // Map applications to match the expected license structure
  const allStaffLicenses = allStaffLicensesData?.map(app => ({
    id: app.id,
    staff_member_id: app.staff_member_id,
    license_type: app.application_name,
    license_number: app.license_number || 'N/A',
    state: app.state,
    status: app.status === 'approved' ? 'active' : app.status === 'rejected' ? 'expired' : 'active',
    expiry_date: app.expiry_date,
    days_until_expiry: app.days_until_expiry,
  })) || []

  // Group licenses by staff member
  const licensesByStaff = allStaffLicenses?.reduce((acc: Record<string, typeof allStaffLicenses>, license) => {
    if (!acc[license.staff_member_id]) {
      acc[license.staff_member_id] = []
    }
    acc[license.staff_member_id].push(license)
    return acc
  }, {}) || {}

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
  const staffWithExpiringLicenses = staffMembers?.map(staff => {
    const licenses = licensesByStaff[staff.id] || []
    const expiringCount = licenses.filter(l => {
      if (l.days_until_expiry) {
        return l.days_until_expiry <= 30 && l.days_until_expiry > 0
      }
      return false
    }).length
    return { ...staff, expiringLicensesCount: expiringCount }
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


