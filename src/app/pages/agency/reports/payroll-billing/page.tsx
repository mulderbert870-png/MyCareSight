import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import { assertAgencyReportsPageAccess } from '@/lib/agency-reports-access'
import DashboardLayout from '@/components/DashboardLayout'
import PayrollBillingReportContent from '@/components/PayrollBillingReportContent'
import { getPayrollBillingApprovedRowsAction } from '@/app/actions/payroll-billing-report'

function defaultDateRange(): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 30)
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

export default async function PayrollBillingReportPage() {
  const session = await getSession()
  if (!session) redirect('/pages/auth/login')

  const supabase = await createClient()
  const { data: profile } = await q.getUserProfileFull(supabase, session.user.id)
  assertAgencyReportsPageAccess(profile)
  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, session.user.id)

  const { from, to } = defaultDateRange()
  const { rows, error } = await getPayrollBillingApprovedRowsAction(from, to)

  return (
    <DashboardLayout
      user={session.user}
      profile={profile}
      unreadNotifications={unreadNotifications || 0}
    >
      <PayrollBillingReportContent
        initialRows={rows}
        initialDateFrom={from}
        initialDateTo={to}
        loadError={error}
      />
    </DashboardLayout>
  )
}
