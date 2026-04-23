-- Bulk mark-as-read: one round-trip from the app; delegates to mark_message_as_read_by_user
-- for each id so notification side-effects stay identical.

CREATE OR REPLACE FUNCTION public.mark_messages_as_read_by_user(p_message_ids uuid[], p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  msg_id uuid;
BEGIN
  IF p_message_ids IS NULL OR cardinality(p_message_ids) = 0 OR p_user_id IS NULL THEN
    RETURN;
  END IF;

  FOREACH msg_id IN ARRAY p_message_ids LOOP
    PERFORM public.mark_message_as_read_by_user(msg_id, p_user_id);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.mark_messages_as_read_by_user(uuid[], uuid) IS
  'Marks many messages read for one user in a single call; wraps mark_message_as_read_by_user (is_read uuid[] + notifications).';

GRANT EXECUTE ON FUNCTION public.mark_messages_as_read_by_user(uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_messages_as_read_by_user(uuid[], uuid) TO service_role;
