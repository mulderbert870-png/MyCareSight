-- Per-client unread message counts for admin readers (replaces N+1 conversation + message fetches).
-- Semantics align with count_unread_messages_for_user (uuid[] is_read).

CREATE OR REPLACE FUNCTION public.admin_unread_message_counts_by_client(
  p_reader_id uuid,
  p_client_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(client_id uuid, unread_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.client_id, COUNT(*)::bigint
  FROM public.messages m
  INNER JOIN public.conversations c ON c.id = m.conversation_id
  WHERE m.sender_id IS DISTINCT FROM p_reader_id
    AND (
      m.is_read IS NULL
      OR pg_catalog.array_length(m.is_read, 1) IS NULL
      OR NOT (p_reader_id = ANY(m.is_read))
    )
    AND (p_client_ids IS NULL OR c.client_id = ANY(p_client_ids))
  GROUP BY c.client_id;
$$;

COMMENT ON FUNCTION public.admin_unread_message_counts_by_client(uuid, uuid[]) IS
  'Unread message counts grouped by agency_admin (conversation.client_id). Optional p_client_ids limits to those clients.';

REVOKE ALL ON FUNCTION public.admin_unread_message_counts_by_client(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_unread_message_counts_by_client(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unread_message_counts_by_client(uuid, uuid[]) TO service_role;
