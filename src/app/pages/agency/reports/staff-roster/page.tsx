import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import DashboardLayout from '@/components/DashboardLayout'
import Link from 'next/link'
import { getStaffRosterReport } from '@/app/actions/reports'
import { ArrowLeft, Download } from 'lucide-react'
import DownloadCSVButton from '@/components/DownloadCSVButton'

export default async function StaffRosterReportPage() {
  const session = await getSession()

  if (!session) {
    redirect('/pages/auth/login')
  }

  const supabase = await createClient()

  const { data: profile } = await q.getUserProfileFull(supabase, session.user.id)
  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, session.user.id)

  // Get report data
  const result = await getStaffRosterReport()
  const reportData = result.data || []

  // Prepare CSV data (caregiver list)
  const csvData = reportData.map(row => ({
    'Caregiver Name': row.staff_name,
    'Email': row.email,
    'Phone': row.phone,
    'Role': row.role,
    'Job Title': row.job_title,
    'Status': row.status
  }))

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

        {/* Report Header */}
        <div className="bg-white rounded-xl shadow-md border border-gray-100 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Staff Roster Report</h1>
              <p className="text-gray-600">
                Caregiver list with contact and role information
              </p>
            </div>
            <DownloadCSVButton 
              data={csvData} 
              filename="staff-roster-report"
              className="px-4 py-2 bg-black text-white font-semibold rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download CSV
            </DownloadCSVButton>
          </div>

          {/* Caregiver list table */}
          {reportData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Caregiver Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Email</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Phone</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Role</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Job Title</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {reportData.map((row, index) => (
                    <tr key={index} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{row.staff_name}</td>
                      <td className="px-4 py-4 text-sm text-gray-600">{row.email}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600">{row.phone}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600">{row.role}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600">{row.job_title}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600">{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-gray-600">No caregivers in your roster</p>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
