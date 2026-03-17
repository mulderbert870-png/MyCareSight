import { requireAdmin } from '@/lib/auth-helpers'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import AdminLayout from '@/components/AdminLayout'
import UserManagementTabs from '@/components/UserManagementTabs'
import { Users } from 'lucide-react'

export default async function UsersPage() {
  const { user, profile } = await requireAdmin()
  const supabase = await createClient()

  const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, user.id)
  const { data: userProfilesRaw } = await q.getUserProfilesOrderedByCreatedAt(supabase)
  type UserProfileRow = { id: string; role: string | null; [key: string]: unknown }
  const profilesList = (userProfilesRaw ?? []) as UserProfileRow[]

  type AgencyRow = { id: string; name: string | null }
  const { data: agenciesListData } = await q.getAgenciesIdName(supabase)
  const agenciesList = (agenciesListData ?? []) as AgencyRow[]
  const agencyNameById: Record<string, string> = {}
  agenciesList.forEach(a => {
    if (a.id && a.name?.trim()) agencyNameById[a.id] = a.name.trim()
  })

  const companyOwnerIds = profilesList.filter(u => u.role === 'company_owner').map(u => u.id)
  type ClientCompanyRow = { company_owner_id: string; company_name: string | null; agency_id: string | null }
  const { data: clientCompaniesData } =
    companyOwnerIds.length > 0
      ? await q.getClientsByCompanyOwnerIds(supabase, companyOwnerIds)
      : { data: [] }
  const clientCompanies = (clientCompaniesData ?? []) as unknown as ClientCompanyRow[]
  const companyNameByUserId: Record<string, string> = {}
  clientCompanies.forEach(c => {
    if (!c.company_owner_id) return
    const name = c.agency_id && agencyNameById[c.agency_id]
      ? agencyNameById[c.agency_id]
      : (c.company_name?.trim() ?? null)
    if (name) companyNameByUserId[c.company_owner_id] = name
  })

  const staffUserIds = profilesList.filter(u => u.role === 'staff_member').map(u => u.id)
  type StaffMemberRow = { user_id: string; agency_id: string | null; company_owner_id: string | null }
  const { data: staffMembersData } =
    staffUserIds.length > 0 ? await q.getStaffMembersByUserIds(supabase, staffUserIds) : { data: [] }
  const staffMembers = (staffMembersData ?? []) as unknown as StaffMemberRow[]
  const clientIdsForStaff = staffMembers.map(s => s.company_owner_id).filter(Boolean) as string[]
  type ClientForStaffRow = { id: string; company_name: string | null; agency_id: string | null }
  const { data: clientsForStaffData } =
    clientIdsForStaff.length > 0
      ? await q.getClientsByIds(supabase, clientIdsForStaff, 'id, company_name, agency_id')
      : { data: [] }
  const clientsForStaff = (clientsForStaffData ?? []) as unknown as ClientForStaffRow[]
  const companyNameByClientId: Record<string, string> = {}
  clientsForStaff.forEach(c => {
    if (!c.id) return
    const name = c.agency_id && agencyNameById[c.agency_id]
      ? agencyNameById[c.agency_id]
      : (c.company_name?.trim() ?? null)
    if (name) companyNameByClientId[c.id] = name
  })
  const companyNameByStaffUserId: Record<string, string> = {}
  staffMembers.forEach(s => {
    if (!s.user_id) return
    const name = s.agency_id && agencyNameById[s.agency_id]
      ? agencyNameById[s.agency_id]
      : (s.company_owner_id ? companyNameByClientId[s.company_owner_id] : null)
    if (name) companyNameByStaffUserId[s.user_id] = name
  })

  const userProfiles = profilesList.map(p => ({
    ...p,
    company_name: p.role === 'company_owner'
      ? (companyNameByUserId[p.id] ?? null)
      : p.role === 'staff_member'
        ? (companyNameByStaffUserId[p.id] ?? null)
        : null,
  }))

  // Get user counts
  const totalUsers = userProfiles?.length || 0
  const activeUsers = userProfiles?.filter(u => u.role !== 'admin' || true).length || 0
  const disabledUsers = 0
  const companies = new Set(userProfiles?.map(u => (u as { company_name?: string | null }).company_name).filter(Boolean)).size

  const { data: clients } = await q.getAllClientsOrdered(supabase)
  const expertUserIds = clients?.filter(c => c.expert_id).map(c => c.expert_id) || []
  const { data: experts } =
    expertUserIds.length > 0 ? await q.getLicensingExpertsByUserIds(supabase, expertUserIds) : { data: [] }
  const { data: allExperts } = await q.getLicensingExpertsActive(supabase)
  
  const expertsByUserId: Record<string, any> = {}
  experts?.forEach(e => {
    expertsByUserId[e.user_id] = e
  })

  const clientIds = clients?.map(c => c.id) || []
  type ClientStateRow = { client_id: string; state: string }
  const { data: clientStatesData } =
    clientIds.length > 0 ? await q.getClientStatesByClientIds(supabase, clientIds) : { data: [] }
  const clientStates = (clientStatesData ?? []) as ClientStateRow[]

  type ConvRow = { id: string; client_id: string }
  const { data: conversationsData } =
    clientIds.length > 0 ? await q.getConversationsByClientIds(supabase, clientIds) : { data: [] }
  const conversations = (conversationsData ?? []) as ConvRow[]
  const conversationIds = conversations.map(c => c.id)
  const { data: messagesData } =
    conversationIds.length > 0
      ? await q.getUnreadMessagesByConversationIds(supabase, conversationIds)
      : { data: [] }
  type MessageRow = { conversation_id: string }
  const messages = (messagesData ?? []) as MessageRow[]

  const messagesByConversation: Record<string, number> = {}
  messages.forEach(m => {
    messagesByConversation[m.conversation_id] = (messagesByConversation[m.conversation_id] || 0) + 1
  })

  const unreadMessagesByClient: Record<string, number> = {}
  conversations.forEach(conv => {
    const unreadCount = messagesByConversation[conv.id] || 0
    if (unreadCount > 0) {
      unreadMessagesByClient[conv.client_id] = (unreadMessagesByClient[conv.client_id] || 0) + unreadCount
    }
  })

  type CaseRow = { client_id: string; progress_percentage: number; status: string }
  const { data: casesData } = await q.getCasesByClientIds(supabase, clientIds, 'client_id, progress_percentage, status')
  const cases = (casesData ?? []) as unknown as CaseRow[]

  // Calculate client statistics
  const totalClients = clients?.length || 0
  const activeApplications = cases?.length || 0
  const pendingReview = cases?.filter(c => c.status === 'under_review').length || 0
  const unreadMessagesCount = messages?.length || 0

  const statesByClient: Record<string, string[]> = {}
  clientStates.forEach(cs => {
    if (!statesByClient[cs.client_id]) {
      statesByClient[cs.client_id] = []
    }
    statesByClient[cs.client_id].push(cs.state)
  })

  const casesByClient: Record<string, any[]> = {}
  cases.forEach(c => {
    if (!casesByClient[c.client_id]) {
      casesByClient[c.client_id] = []
    }
    casesByClient[c.client_id].push(c)
  })

  type LicensingExpertRow = { id: string; status?: string; [key: string]: unknown }
  const { data: allExpertsDataRaw } = await q.getLicensingExpertsOrdered(supabase)
  const allExpertsData = (allExpertsDataRaw ?? []) as LicensingExpertRow[]
  const expertIds = allExpertsData.map(e => e.id)
  type ExpertStateRow = { expert_id: string; state: string }
  const { data: expertStatesData } =
    expertIds.length > 0 ? await q.getExpertStatesByExpertIds(supabase, expertIds) : { data: [] }
  const expertStates = (expertStatesData ?? []) as ExpertStateRow[]
  const { data: expertClientsData } = await q.getClientsByExpertIds(supabase, expertIds)
  const expertClients = (expertClientsData ?? []) as { expert_id: string }[]
  const totalExperts = allExpertsData.length
  const activeExperts = allExpertsData.filter(e => e.status === 'active').length
  const assignedClients = expertClients.length

  const statesByExpert: Record<string, string[]> = {}
  expertStates.forEach(es => {
    if (!statesByExpert[es.expert_id]) {
      statesByExpert[es.expert_id] = []
    }
    statesByExpert[es.expert_id].push(es.state)
  })

  const clientsByExpert: Record<string, number> = {}
  expertClients.forEach(c => {
    if (c.expert_id) {
      clientsByExpert[c.expert_id] = (clientsByExpert[c.expert_id] || 0) + 1
    }
  })

  const { data: agenciesData } = await q.getAgenciesIdName(supabase)
  const agencies = (agenciesData ?? []) as { id: string; name: string | null }[]

  return (
    <AdminLayout 
      user={user} 
      profile={profile} 
      unreadNotifications={unreadNotifications || 0}
    >
      <div className="space-y-4 md:space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2 md:gap-3">
            <Users className="w-6 h-6 md:w-8 md:h-8 text-purple-600" />
            <span className="break-words">User Management</span>
          </h1>
          <p className="text-sm md:text-base text-gray-600 mt-1">Manage users, clients, and licensing experts</p>
        </div>

        {/* Tabbed Content */}
        <UserManagementTabs
          userProfiles={userProfiles || []}
          totalUsers={totalUsers}
          activeUsers={activeUsers}
          disabledUsers={disabledUsers}
          companies={companies}
          clients={clients || []}
          agencies={agencies.map((a) => ({ id: a.id, name: a.name ?? '' }))}
          expertsByUserId={expertsByUserId}
          allExperts={allExperts || []}
          statesByClient={statesByClient}
          casesByClient={casesByClient}
          unreadMessagesByClient={unreadMessagesByClient}
          totalClients={totalClients}
          activeApplications={activeApplications}
          pendingReview={pendingReview}
          unreadMessagesCount={unreadMessagesCount}
          experts={allExpertsData || []}
          statesByExpert={statesByExpert}
          clientsByExpert={clientsByExpert}
          totalExperts={totalExperts}
          activeExperts={activeExperts}
          assignedClients={assignedClients}
        />
      </div>
    </AdminLayout>
  )
}

