-- Direct INSERT into schedule_assignment_requests still fails for some caregivers because WITH CHECK
-- subqueries evaluate under the invoker: scheduled_visits / caregiver_members RLS can hide rows even
-- when the user should be allowed. Mirror approve_schedule_assignment_request: use SECURITY DEFINER RPC.

CREATE OR REPLACE FUNCTION public.submit_schedule_assignment_request(
  p_schedule_id uuid,
  p_caregiver_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cm_id uuid;
  v_note text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  v_note := NULLIF(trim(COALESCE(p_caregiver_note, '')), '');

  SELECT cm.id INTO v_cm_id
  FROM public.scheduled_visits sv
  INNER JOIN public.caregiver_members cm
    ON cm.user_id = auth.uid()
  WHERE sv.id = p_schedule_id
    AND sv.caregiver_member_id IS NULL
    AND sv.agency_id IS NOT NULL
    AND (
      (cm.agency_id IS NOT NULL AND cm.agency_id = sv.agency_id)
      OR (
        cm.agency_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.agency_admins aa
          WHERE aa.agency_id = sv.agency_id
            AND aa.id = cm.company_owner_id
        )
      )
    )
  LIMIT 1;

  IF v_cm_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot_request');
  END IF;

  INSERT INTO public.schedule_assignment_requests (
    schedule_id,
    caregiver_member_id,
    status,
    caregiver_note
  )
  VALUES (
    p_schedule_id,
    v_cm_id,
    'pending',
    v_note
  );

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'duplicate_pending');
END;
$$;

REVOKE ALL ON FUNCTION public.submit_schedule_assignment_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_schedule_assignment_request(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.submit_schedule_assignment_request(uuid, text) IS
  'Caregiver submits a pending assignment request; bypasses INSERT RLS. Validates open visit and agency match.';
