import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import DashboardLayout from '@/components/DashboardLayout'
import ClientMessagesContent from '@/components/ClientMessagesContent'
import { MessageSquare } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function MessagesPage() {
  try {
    const session = await getSession()
    if (!session) redirect('/pages/auth/login')

    const supabase = await createClient()
    const { data: profile } = await q.getUserProfileFull(supabase, session.user.id)

    if (profile?.role === 'admin') redirect('/pages/admin')
    if (profile?.role === 'expert') redirect('/pages/expert/messages')

    const { data: client, error: clientError } = await q.getClientByCompanyOwnerId(supabase, session.user.id)
    if (clientError || !client) {
      return (
        <DashboardLayout user={session.user} profile={profile} unreadNotifications={0}>
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center p-8">
              <MessageSquare className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-700 mb-2">No Client Record Found</h3>
              <p className="text-sm text-gray-500">
                Please contact the administrator to set up your client account.
              </p>
            </div>
          </div>
        </DashboardLayout>
      )
    }

    const { count: unreadNotifications } = await q.getUnreadNotificationsCount(supabase, session.user.id)
    const { data: conversationsData } = await q.getConversationsByClientId(supabase, client.id)
    const conversations = conversationsData ?? []

    const { data: adminProfile } = await q.getFirstAdminUserId(supabase)
    const adminUserId = adminProfile?.id ?? null

    const conversationIds = conversations.map(c => c.id)
    const { data: unreadCountsData } =
      conversationIds.length > 0
        ? await q.getUnreadMessagesByConversationIds(supabase, conversationIds, session.user.id)
        : { data: [] }
    const unreadCounts = unreadCountsData ?? []

    const unreadCountsByConv: Record<string, number> = {}
    unreadCounts.forEach((msg: { conversation_id: string }) => {
      unreadCountsByConv[msg.conversation_id] = (unreadCountsByConv[msg.conversation_id] || 0) + 1
    })

    const conversationsWithData: Array<{
      id: string
      client_id: string
      expert_id: string | null
      last_message_at: string
      expert?: { user_id: string; first_name: string; last_name: string }
      unread_count: number
      conversation_type: 'admin' | 'expert'
    }> = []

    const expertRecordIds = conversations.map(c => c.expert_id).filter(Boolean) as string[]
    const { data: expertRecordsData } =
      expertRecordIds.length > 0 ? await q.getLicensingExpertsByIds(supabase, expertRecordIds) : { data: [] }
    type ExpertRow = { id: string; user_id?: string; first_name?: string; last_name?: string }
    const expertRecords = (expertRecordsData ?? []) as unknown as ExpertRow[]

    const expertsById: Record<string, ExpertRow> = {}
    expertRecords.forEach(e => {
      expertsById[e.id] = e
    })

  conversations.forEach(conv => {
    if (conv.admin_id && !conv.expert_id) {
      // Admin conversation
      conversationsWithData.push({
        id: conv.id,
        client_id: conv.client_id,
        expert_id: null,
        last_message_at: conv.last_message_at,
        expert: undefined,
        unread_count: unreadCountsByConv[conv.id] || 0,
        conversation_type: 'admin'
      })
    } else if (conv.expert_id && !conv.admin_id) {
      // Expert conversation
      const expertRecord = expertsById[conv.expert_id]
      if (expertRecord) {
        conversationsWithData.push({
          id: conv.id,
          client_id: conv.client_id,
          expert_id: conv.expert_id,
          last_message_at: conv.last_message_at,
          expert: {
            user_id: expertRecord.user_id ?? '',
            first_name: expertRecord.first_name ?? '',
            last_name: expertRecord.last_name ?? ''
          },
          unread_count: unreadCountsByConv[conv.id] || 0,
          conversation_type: 'expert'
        })
      }
    }
  })

  // Sort by last_message_at
  conversationsWithData.sort((a, b) => {
    const dateA = new Date(a.last_message_at).getTime()
    const dateB = new Date(b.last_message_at).getTime()
    return dateB - dateA
  })

  return (
    <DashboardLayout 
      user={session.user} 
      profile={profile} 
      unreadNotifications={unreadNotifications || 0}
    >
      <ClientMessagesContent 
        initialConversations={conversationsWithData}
        userId={session.user.id}
        clientId={client?.id || ''}
        adminUserId={adminUserId || undefined}
      />
    </DashboardLayout>
    )
  } catch (error) {
    console.error('Error in MessagesPage:', error)
    return (
      <DashboardLayout 
        user={{ id: '', email: null }} 
        profile={null} 
        unreadNotifications={0}
      >
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center p-8">
            <MessageSquare className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">Error Loading Messages</h3>
            <p className="text-sm text-gray-500">
              An error occurred while loading the messages page. Please try again later.
            </p>
          </div>
        </div>
      </DashboardLayout>
    )
  }
}
