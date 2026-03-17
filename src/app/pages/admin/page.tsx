import { requireAdmin } from '@/lib/auth-helpers'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import AdminLayout from '@/components/AdminLayout'
import CasesByStatusChart from '@/components/CasesByStatusChart'
import CasesByStateChart from '@/components/CasesByStateChart'
import CasesTableWithFilters from '@/components/CasesTableWithFilters'
import { 
  Users, 
  Clock, 
  AlertCircle, 
  CheckCircle2,
  TrendingUp,
  LayoutDashboard
} from 'lucide-react'

export default async function AdminDashboardPage() {
  const { user, profile } = await requireAdmin()
  const supabase = await createClient()

  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, user.id)
  const { data: cases } = await q.getCases(supabase)

  // Calculate statistics
  const totalCases = cases?.length || 0
  const inProgress = cases?.filter(c => c.status === 'in_progress').length || 0
  const inReview = cases?.filter(c => c.status === 'under_review').length || 0
  const completed = cases?.filter(c => c.status === 'approved').length || 0
  const avgProgress = cases && cases.length > 0
    ? Math.round(cases.reduce((acc, c) => acc + (c.progress_percentage || 0), 0) / cases.length)
    : 0

  // Cases by status for pie chart
  const statusCounts = {
    in_progress: cases?.filter(c => c.status === 'in_progress').length || 0,
    under_review: cases?.filter(c => c.status === 'under_review').length || 0,
    approved: cases?.filter(c => c.status === 'approved').length || 0,
    rejected: cases?.filter(c => c.status === 'rejected').length || 0,
  }

  // Cases by state for bar chart
  const stateCounts: Record<string, number> = {}
  cases?.forEach(caseItem => {
    stateCounts[caseItem.state] = (stateCounts[caseItem.state] || 0) + 1
  })

  return (
    <AdminLayout 
      user={{ id: user.id, email: user.email }} 
      profile={profile} 
      unreadNotifications={unreadNotifications || 0}
    >
      <div className="space-y-4 md:space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2 md:gap-3">
            <LayoutDashboard className="w-6 h-6 md:w-8 md:h-8 text-purple-600" />
            <span className="break-words">Admin Dashboard</span>
          </h1>
          <p className="text-sm md:text-base text-gray-600 mt-1">Monitor and manage all licensing cases</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 md:gap-6">
          <div className="bg-white rounded-xl p-4 md:p-6 shadow-md border border-gray-100">
            <div className="flex items-center justify-between mb-3 md:mb-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <Users className="w-5 h-5 md:w-6 md:h-6 text-blue-600" />
              </div>
            </div>
            <div className="text-xl md:text-2xl font-bold text-gray-900 mb-1">{totalCases}</div>
            <div className="text-xs md:text-sm text-gray-600">All time</div>
          </div>

          <div className="bg-white rounded-xl p-4 md:p-6 shadow-md border border-gray-100">
            <div className="flex items-center justify-between mb-3 md:mb-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                <Clock className="w-5 h-5 md:w-6 md:h-6 text-orange-600" />
              </div>
            </div>
            <div className="text-xl md:text-2xl font-bold text-gray-900 mb-1">{inProgress}</div>
            <div className="text-xs md:text-sm text-gray-600">Active cases</div>
          </div>

          <div className="bg-white rounded-xl p-4 md:p-6 shadow-md border border-gray-100">
            <div className="flex items-center justify-between mb-3 md:mb-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                <AlertCircle className="w-5 h-5 md:w-6 md:h-6 text-yellow-600" />
              </div>
            </div>
            <div className="text-xl md:text-2xl font-bold text-gray-900 mb-1">{inReview}</div>
            <div className="text-xs md:text-sm text-gray-600">Pending approval</div>
          </div>

          <div className="bg-white rounded-xl p-4 md:p-6 shadow-md border border-gray-100">
            <div className="flex items-center justify-between mb-3 md:mb-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 md:w-6 md:h-6 text-green-600" />
              </div>
            </div>
            <div className="text-xl md:text-2xl font-bold text-gray-900 mb-1">{completed}</div>
            <div className="text-xs md:text-sm text-gray-600">Successfully licensed</div>
          </div>

          <div className="bg-white rounded-xl p-4 md:p-6 shadow-md border border-gray-100">
            <div className="flex items-center justify-between mb-3 md:mb-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 md:w-6 md:h-6 text-purple-600" />
              </div>
            </div>
            <div className="text-xl md:text-2xl font-bold text-gray-900 mb-1">{avgProgress}%</div>
            <div className="text-xs md:text-sm text-gray-600">Across all cases</div>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          {/* Cases by Status Pie Chart */}
          <div className="bg-white rounded-xl p-4 md:p-6 shadow-md border border-gray-100">
            <h2 className="text-lg md:text-xl font-bold text-gray-900 mb-4">Cases by Status</h2>
            <CasesByStatusChart totalCases={totalCases} statusCounts={statusCounts} />
          </div>

          {/* Cases by State Bar Chart */}
          <div className="bg-white rounded-xl p-4 md:p-6 shadow-md border border-gray-100">
            <h2 className="text-lg md:text-xl font-bold text-gray-900 mb-4">Cases by State</h2>
            <CasesByStateChart stateCounts={stateCounts} />
          </div>
        </div>

        {/* Case Management Table */}
        <CasesTableWithFilters cases={cases || []} />
      </div>
    </AdminLayout>
  )
}

