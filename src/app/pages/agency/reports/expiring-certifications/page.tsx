import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import DashboardLayout from '@/components/DashboardLayout'
import Link from 'next/link'
import { getExpiringCertificationsReport } from '@/app/actions/reports'
import { ArrowLeft, Download, Clock, XCircle } from 'lucide-react'
import DownloadCSVButton from '@/components/DownloadCSVButton'
import DownloadCertificationButton from '@/components/DownloadCertificationButton'

export default async function ExpiringCertificationsReportPage() {
  const session = await getSession()

  if (!session) {
    redirect('/pages/auth/login')
  }

  const supabase = await createClient()
  const { data: profile } = await q.getUserProfileFull(supabase, session.user.id)
  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, session.user.id)

  // Get report data
  const result = await getExpiringCertificationsReport()
  const reportData = result.data || []

  const getStatusBadge = (status: string) => {
    if (status === 'Expiring Soon') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700">
          <Clock className="w-3 h-3" />
          Expiring Soon
        </span>
      )
    } else {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
          <XCircle className="w-3 h-3" />
          Expired
        </span>
      )
    }
  }

  // Prepare CSV data
  const csvData = reportData.map(row => ({
    'Staff Name': row.staff_name,
    'Contact': row.contact,
    'Certification': row.certification,
    'Cert Number': row.cert_number,
    'Expiration': row.expiration,
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
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Expiring Certifications Report</h1>
              <p className="text-gray-600">
                Staff certifications that are expiring soon or have expired
              </p>
            </div>
            <DownloadCSVButton 
              data={csvData} 
              filename="expiring-certifications-report"
              className="px-4 py-2 bg-black text-white font-semibold rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download CSV
            </DownloadCSVButton>
          </div>

          {/* Report Table */}
          {reportData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px]">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Staff Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Contact</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Certification</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Cert Number</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Expiration</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {reportData.map((row, index) => (
                    <tr key={index} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{row.staff_name}</td>
                      <td className="px-4 py-4 text-sm text-gray-600">{row.contact}</td>
                      <td className="px-4 py-4 text-sm text-gray-900">{row.certification}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600">{row.cert_number}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600">{row.expiration}</td>
                      <td className="px-4 py-4 whitespace-nowrap">{getStatusBadge(row.status)}</td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <DownloadCertificationButton
                          documentUrl={row.document_url}
                          certificationName={row.certification}
                          staffName={row.staff_name}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-gray-600">No expiring certifications found</p>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
