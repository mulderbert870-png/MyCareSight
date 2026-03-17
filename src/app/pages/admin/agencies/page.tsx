import { requireAdmin } from '@/lib/auth-helpers'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import AdminLayout from '@/components/AdminLayout'
import AgenciesContent from '@/components/AgenciesContent'
import { Building2 } from 'lucide-react'

export default async function AgenciesPage() {
  const { user, profile } = await requireAdmin()
  const supabase = await createClient()

  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, user.id)
  const { data: agencies } = await q.getAgenciesOrdered(supabase)
  const { data: agencyAdmins } = await q.getClientsWithCompanyOwner(supabase)

  // One agency admin can only be in one agency: show only those not in any agency's agency_admin_ids
  const assignedAdminIds = new Set<string>()
  for (const a of agencies || []) {
    const ids = (a.agency_admin_ids as string[] | null) || []
    ids.forEach((id) => assignedAdminIds.add(id))
  }
  const allAdmins = agencyAdmins || []
  const agencyAdminsForSelect = allAdmins.filter((a) => !assignedAdminIds.has(a.id))

  return (
    <AdminLayout
      user={user}
      profile={profile}
      unreadNotifications={unreadNotifications || 0}
    >
      <div className="space-y-4 md:space-y-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2 md:gap-3">
            <Building2 className="w-6 h-6 md:w-8 md:h-8 text-purple-600" />
            <span className="break-words">Agencies</span>
          </h1>
          <p className="text-sm md:text-base text-gray-600 mt-1">
            Manage agencies (companies) and tie them to agency admins.
          </p>
        </div>

        <AgenciesContent
          agencies={agencies || []}
          agencyAdmins={(agencyAdmins || []).map((a) => ({
            id: a.id,
            contact_name: a.contact_name ?? '',
            contact_email: a.contact_email ?? '',
          }))}
          agencyAdminsForSelect={(agencyAdminsForSelect || []).map((a) => ({
            id: a.id,
            contact_name: a.contact_name ?? '',
            contact_email: a.contact_email ?? '',
          }))}
        />
      </div>
    </AdminLayout>
  )
}
