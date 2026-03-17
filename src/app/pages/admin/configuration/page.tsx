import { requireAdmin } from '@/lib/auth-helpers'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import AdminLayout from '@/components/AdminLayout'
import ConfigurationContent from '@/components/ConfigurationContent'
import { getCurrentPricing } from '@/app/actions/pricing'
import { getCertificationTypes, getStaffRoles } from '@/app/actions/system-lists'

export default async function ConfigurationPage() {
  const { user, profile } = await requireAdmin()
  const supabase = await createClient()

  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, user.id)
  const pricingResult = await getCurrentPricing()
  const pricingData = pricingResult.data
  const { data: licenseTypes } = await q.getLicenseTypesActive(
    supabase,
    'id, name, state, renewal_period_display, cost_display, service_fee_display, processing_time_display'
  )

  // Get system lists data
  
  const certTypesResult = await getCertificationTypes()
  const certificationTypes = certTypesResult.data || []
  
  
  const rolesResult = await getStaffRoles()
  const staffRoles = rolesResult.data || []

  return (
    <AdminLayout 
      user={user} 
      profile={profile} 
      unreadNotifications={unreadNotifications || 0}
    >
      <ConfigurationContent
        initialPricing={pricingData || { owner_admin_license: 50, staff_license: 25 }}
        licenseTypes={(licenseTypes ?? []) as unknown as Parameters<typeof ConfigurationContent>[0]['licenseTypes']}
        certificationTypes={certificationTypes}
        staffRoles={staffRoles}
      />
    </AdminLayout>
  )
}
