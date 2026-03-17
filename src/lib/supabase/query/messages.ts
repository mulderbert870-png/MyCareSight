import type { Supabase } from '../types'

export async function getConversationByApplicationId(supabase: Supabase, applicationId: string) {
  return supabase
    .from('conversations')
    .select('id')
    .eq('application_id', applicationId)
    .maybeSingle()
}

export async function insertConversation(
  supabase: Supabase,
  data: { client_id: string; application_id: string }
) {
  return supabase.from('conversations').insert(data).select().single()
}

export async function getMessagesByConversationId(supabase: Supabase, conversationId: string) {
  return supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
}

/** Get all messages in given conversation ids (for expert unread list). */
export async function getMessagesByConversationIds(supabase: Supabase, conversationIds: string[]) {
  if (conversationIds.length === 0) return { data: [], error: null }
  return supabase
    .from('messages')
    .select('*')
    .in('conversation_id', conversationIds)
}

/** Mark all messages in a conversation as read except those sent by excludeSenderId. */
export async function markConversationMessagesAsReadExceptSender(
  supabase: Supabase,
  conversationId: string,
  excludeSenderId: string
) {
  return supabase
    .from('messages')
    .update({ is_read: true })
    .eq('conversation_id', conversationId)
    .neq('sender_id', excludeSenderId)
}

export async function rpcMarkMessageAsReadByUser(
  supabase: Supabase,
  messageId: string,
  userId: string
) {
  return supabase.rpc('mark_message_as_read_by_user', {
    message_id: messageId,
    user_id: userId,
  })
}

export async function insertMessage(
  supabase: Supabase,
  data: { conversation_id: string; sender_id: string; content: string }
) {
  return supabase.from('messages').insert(data).select().single()
}

export async function updateConversationLastMessageAt(supabase: Supabase, conversationId: string) {
  return supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId)
}

/** RPC: get total unread message count for user in given conversations. */
export async function rpcGetTotalUnreadCountForUser(
  supabase: Supabase,
  conversationIds: string[],
  userId: string
) {
  return supabase.rpc('get_total_unread_count_for_user', {
    conversation_ids: conversationIds,
    user_id: userId,
  })
}

/** Get unread notifications for user (id, type, title). */
export async function getUnreadNotificationsByUserId(supabase: Supabase, userId: string) {
  return supabase
    .from('notifications')
    .select('id, type, title')
    .eq('user_id', userId)
    .eq('is_read', false)
}

/** Get unread notification items (id, title, type, created_at) for dropdown, limit 20. */
export async function getUnreadNotificationItems(
  supabase: Supabase,
  userId: string
) {
  return supabase
    .from('notifications')
    .select('id, title, type, created_at')
    .eq('user_id', userId)
    .eq('is_read', false)
    .order('created_at', { ascending: false })
    .limit(20)
}

/** Get conversation application_ids (for admin dropdown). */
export async function getConversationApplicationIds(supabase: Supabase, limitCount = 100) {
  return supabase
    .from('conversations')
    .select('application_id')
    .not('application_id', 'is', null)
    .limit(limitCount)
}

/** Get conversation ids (for admin badge count). */
export async function getConversationIds(supabase: Supabase, limitCount = 500) {
  return supabase.from('conversations').select('id').limit(limitCount)
}

/** Get conversations by admin_id (for admin messages page). */
export async function getConversationsByAdminId(supabase: Supabase, adminId: string) {
  return supabase
    .from('conversations')
    .select('*')
    .eq('admin_id', adminId)
    .order('last_message_at', { ascending: false })
}

/** Get conversations by client ids. */
export async function getConversationsByClientIds(supabase: Supabase, clientIds: string[]) {
  if (clientIds.length === 0) return { data: [], error: null }
  return supabase
    .from('conversations')
    .select('*')
    .in('client_id', clientIds)
    .order('last_message_at', { ascending: false })
}

/** Get conversation by client_id (single). */
export async function getConversationByClientId(supabase: Supabase, clientId: string) {
  return supabase
    .from('conversations')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()
}

/** Get conversations by client_id (list, for client messages page). */
export async function getConversationsByClientId(supabase: Supabase, clientId: string) {
  return supabase
    .from('conversations')
    .select('id, client_id, expert_id, admin_id, last_message_at, created_at, updated_at')
    .eq('client_id', clientId)
    .order('last_message_at', { ascending: false })
}

/** Get conversations with application embed by application ids (for expert messages). */
export async function getConversationsWithApplicationByApplicationIds(
  supabase: Supabase,
  applicationIds: string[]
) {
  if (applicationIds.length === 0) return { data: [], error: null }
  return supabase
    .from('conversations')
    .select(`
      *,
      application:applications!inner(id, application_name, state, company_owner_id)
    `)
    .in('application_id', applicationIds)
    .order('last_message_at', { ascending: false, nullsFirst: false })
}

/** Get unread message rows by conversation ids (optional exclude sender for admin unread count). */
export async function getUnreadMessagesByConversationIds(
  supabase: Supabase,
  conversationIds: string[],
  excludeSenderId?: string
) {
  if (conversationIds.length === 0) return { data: [], error: null }
  let q = supabase
    .from('messages')
    .select('conversation_id')
    .in('conversation_id', conversationIds)
    .eq('is_read', false)
  if (excludeSenderId != null) q = q.neq('sender_id', excludeSenderId)
  return q
}

/** RPC: per-conversation unread counts for user. */
export async function rpcCountUnreadMessagesForUser(
  supabase: Supabase,
  conversationIds: string[],
  userId: string
) {
  return supabase.rpc('count_unread_messages_for_user', {
    conversation_ids: conversationIds,
    user_id: userId,
  })
}

/** Get conversations with application (id, application_id, last_message_at, applications). */
export async function getConversationsWithApplications(
  supabase: Supabase,
  applicationIds: string[]
) {
  if (applicationIds.length === 0) return { data: [], error: null }
  return supabase
    .from('conversations')
    .select('id, application_id, last_message_at, applications(id, application_name, state, company_owner_id)')
    .in('application_id', applicationIds)
    .order('last_message_at', { ascending: false })
}

/** Mark notification as read by id. */
export async function markNotificationAsRead(supabase: Supabase, notificationId: string) {
  return supabase.from('notifications').update({ is_read: true }).eq('id', notificationId)
}

/** Delete notification by id and user_id. */
export async function deleteNotificationByIdAndUser(
  supabase: Supabase,
  notificationId: string,
  userId: string
) {
  return supabase.from('notifications').delete().eq('id', notificationId).eq('user_id', userId)
}

/** Get unread notifications count for user. */
export async function getUnreadNotificationsCount(supabase: Supabase, userId: string) {
  return supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false)
}

/** Get unread notifications for user (full rows), optional limit, for dashboard. */
export async function getUnreadNotificationsForUser(
  supabase: Supabase,
  userId: string,
  limit = 10
) {
  return supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .eq('is_read', false)
    .order('created_at', { ascending: false })
    .limit(limit)
}
