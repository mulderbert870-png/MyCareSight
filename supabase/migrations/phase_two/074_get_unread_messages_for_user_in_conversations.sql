-- Bounded fetch of unread messages for a user across conversations (expert inbox).
-- Matches unread semantics used by count_unread_messages_for_user / get_total_unread_count_for_user.

CREATE OR REPLACE FUNCTION public.get_unread_messages_for_user_in_conversations(
  conversation_ids uuid[],
  p_user_id uuid,
  max_rows integer DEFAULT 500
)
RETURNS SETOF public.messages
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.*
  FROM public.messages m
  WHERE m.conversation_id = ANY(conversation_ids)
    AND m.sender_id <> p_user_id
    AND (
      m.is_read IS NULL
      OR array_length(m.is_read, 1) IS NULL
      OR NOT (p_user_id = ANY(m.is_read))
    )
  ORDER BY m.created_at DESC
  LIMIT LEAST(5000, GREATEST(1, COALESCE(NULLIF(max_rows, 0), 500)));
$$;

COMMENT ON FUNCTION public.get_unread_messages_for_user_in_conversations(uuid[], uuid, integer) IS
  'Returns unread message rows for p_user_id in the given conversations, newest first, capped for memory safety. SECURITY DEFINER (same pattern as count_unread_messages_for_user).';

REVOKE ALL ON FUNCTION public.get_unread_messages_for_user_in_conversations(uuid[], uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unread_messages_for_user_in_conversations(uuid[], uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unread_messages_for_user_in_conversations(uuid[], uuid, integer) TO service_role;
