-- Allow caregivers to cancel their own pending unassignment request.

CREATE OR REPLACE FUNCTION public.cancel_schedule_unassignment_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cm_id uuid;
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT sur.caregiver_member_id, sur.status
  INTO v_cm_id, v_status
  FROM public.schedule_unassignment_requests sur
  WHERE sur.id = p_request_id;

  IF v_cm_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.caregiver_members cm
    WHERE cm.id = v_cm_id
      AND cm.user_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  DELETE FROM public.schedule_unassignment_requests
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_schedule_unassignment_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_schedule_unassignment_request(uuid) TO authenticated;

COMMENT ON FUNCTION public.cancel_schedule_unassignment_request(uuid) IS
  'Caregiver withdraws their own pending unassignment request.';
