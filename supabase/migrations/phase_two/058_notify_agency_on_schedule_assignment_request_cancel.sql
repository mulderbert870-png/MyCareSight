-- When a caregiver cancels (withdraws) a pending schedule assignment request, notify agency
-- admins and care coordinators (same audience as new-request notifications).

CREATE OR REPLACE FUNCTION public.notify_agency_staff_schedule_assignment_request_cancelled(
  p_agency_id uuid,
  p_caregiver_member_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_title text;
  r record;
  v_requester uuid;
BEGIN
  IF p_agency_id IS NULL THEN
    RETURN;
  END IF;

  SELECT cm.user_id INTO v_requester
  FROM public.caregiver_members cm
  WHERE cm.id = p_caregiver_member_id;

  SELECT NULLIF(trim(coalesce(nullif(trim(up.full_name), ''), '')), '')
  INTO v_name
  FROM public.caregiver_members cm
  LEFT JOIN public.user_profiles up ON up.id = cm.user_id
  WHERE cm.id = p_caregiver_member_id;

  IF v_name IS NULL OR v_name = '' THEN
    v_name := 'A caregiver';
  END IF;

  v_title := v_name || ' withdrew their assignment request for an open visit';

  FOR r IN
    SELECT DISTINCT u.uid
    FROM (
      SELECT aa.user_id AS uid
      FROM public.agency_admins aa
      WHERE aa.agency_id = p_agency_id
        AND aa.user_id IS NOT NULL
        AND lower(coalesce(aa.status, 'active')) IN ('active', 'invited')
      UNION
      SELECT cc.user_id AS uid
      FROM public.care_coordinators cc
      WHERE cc.agency_id = p_agency_id
        AND lower(coalesce(cc.status, 'active')) IN ('active', 'invited')
    ) u
    WHERE u.uid IS NOT NULL
  LOOP
    IF v_requester IS NOT NULL AND r.uid = v_requester THEN
      CONTINUE;
    END IF;
    INSERT INTO public.notifications (user_id, title, type)
    VALUES (r.uid, v_title, 'general');
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_agency_staff_schedule_assignment_request_cancelled(uuid, uuid) FROM PUBLIC;

COMMENT ON FUNCTION public.notify_agency_staff_schedule_assignment_request_cancelled(uuid, uuid) IS
  'Creates one in-app notification per agency admin and care coordinator when a caregiver cancels a pending request (SECURITY DEFINER).';

CREATE OR REPLACE FUNCTION public.cancel_schedule_assignment_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cm_id uuid;
  v_agency_id uuid;
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT sar.caregiver_member_id, sar.status, sv.agency_id
  INTO v_cm_id, v_status, v_agency_id
  FROM public.schedule_assignment_requests sar
  INNER JOIN public.scheduled_visits sv ON sv.id = sar.schedule_id
  WHERE sar.id = p_request_id;

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

  DELETE FROM public.schedule_assignment_requests
  WHERE id = p_request_id;

  PERFORM public.notify_agency_staff_schedule_assignment_request_cancelled(v_agency_id, v_cm_id);

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_schedule_assignment_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_schedule_assignment_request(uuid) TO authenticated;

COMMENT ON FUNCTION public.cancel_schedule_assignment_request(uuid) IS
  'Caregiver withdraws their own pending assignment request; notifies agency admins and care coordinators.';
