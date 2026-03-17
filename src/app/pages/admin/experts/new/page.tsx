import { requireAdmin } from '@/lib/auth-helpers'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import AdminLayout from '@/components/AdminLayout'
import AddExpertForm from '@/components/AddExpertForm'

export default async function NewExpertPage() {
  const { user, profile } = await requireAdmin()
  const supabase = await createClient()

  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, user.id)

  return (
    <AdminLayout 
      user={user} 
      profile={profile} 
      unreadNotifications={unreadNotifications || 0}
    >
      <AddExpertForm />
    </AdminLayout>
  )
}
