import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import { assertAgencyReportsPageAccess } from '@/lib/agency-reports-access'
import DashboardLayout from '@/components/DashboardLayout'
import Link from 'next/link'
import { getStaffRosterReport } from '@/app/actions/reports'
import { ArrowLeft } from 'lucide-react'
import StaffRosterReportClient from '@/components/reports/StaffRosterReportClient'

export default async function StaffRosterReportPage() {
  const session = await getSession()

  if (!session) {
    redirect('/pages/auth/login')
  }

  const supabase = await createClient()

  const { data: profile } = await q.getUserProfileFull(supabase, session.user.id)
  assertAgencyReportsPageAccess(profile)
  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, session.user.id)

  // Get report data
  const result = await getStaffRosterReport()
  const reportData = result.data || []

  return (
    <DashboardLayout 
      user={session.user} 
      profile={profile} 
      unreadNotifications={unreadNotifications || 0}
    >
      <div className="space-y-6">
        {/* Back Link */}
        <Link
          href="/pages/agency/reports"
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Reports
        </Link>

        <StaffRosterReportClient reportData={reportData} />
      </div>
    </DashboardLayout>
  )
}
