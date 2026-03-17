import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import DashboardLayout from '@/components/DashboardLayout'
import LicenseDetailContent from '@/components/LicenseDetailContent'

export default async function LicenseDetailPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()

  if (!session) {
    redirect('/pages/auth/login')
  }

  const { id } = await params
  const supabase = await createClient()
  const { data: profile } = await q.getUserProfileFull(supabase, session.user.id)
  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, session.user.id)
  const { data: license } = await q.getLicenseByIdAndOwner(supabase, id, session.user.id)
  if (!license) redirect('/pages/agency/licenses')
  const { data: documentsData } = await q.getLicenseDocumentsByLicenseId(supabase, id)
  const documents = documentsData ?? []

  return (
    <DashboardLayout user={session.user} profile={profile} unreadNotifications={unreadNotifications || 0}>
      <LicenseDetailContent 
        license={license}
        documents={documents}
      />
    </DashboardLayout>
  )
}
