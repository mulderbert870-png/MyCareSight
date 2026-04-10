-- Notify the requesting caregiver (and others auto-declined on approve) when a coordinator
-- approves or declines a schedule assignment request. Titles start with "Visit assignment "
-- so the app can deep-link caregivers to My Care Visits.

CREATE OR REPLACE FUNCTION public.notify_caregiver_user_in_app(p_user_id uuid, p_title text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (user_id, title, type)
  VALUES (p_user_id, left(trim(p_title), 500), 'general');
END;
$$;

REVOKE ALL ON FUNCTION public.notify_caregiver_user_in_app(uuid, text) FROM PUBLIC;

COMMENT ON FUNCTION public.notify_caregiver_user_in_app(uuid, text) IS
  'Insert one in-app notification for a caregiver auth user (SECURITY DEFINER).';

CREATE OR REPLACE FUNCTION public.approve_schedule_assignment_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule_id uuid;
  v_caregiver_id uuid;
  v_status text;
  v_patient_id uuid;
  v_updated int;
  v_client_label text;
  v_approved_user_id uuid;
  r record;
  v_other_user_id uuid;
  v_superseded_title text;
BEGIN
  SELECT sar.schedule_id, sar.caregiver_member_id, sar.status
  INTO v_schedule_id, v_caregiver_id, v_status
  FROM public.schedule_assignment_requests sar
  WHERE sar.id = p_request_id
  FOR UPDATE;

  IF v_schedule_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  SELECT sv.patient_id INTO v_patient_id
  FROM public.scheduled_visits sv
  WHERE sv.id = v_schedule_id;

  IF v_patient_id IS NULL OR NOT public.can_access_patient(v_patient_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  UPDATE public.scheduled_visits
  SET caregiver_member_id = v_caregiver_id,
      updated_at = now()
  WHERE id = v_schedule_id
    AND caregiver_member_id IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'schedule_already_assigned');
  END IF;

  UPDATE public.schedule_assignment_requests
  SET status = 'approved',
      resolved_at = now(),
      resolved_by = auth.uid(),
      updated_at = now()
  WHERE id = p_request_id;

  SELECT coalesce(nullif(trim(p.full_name), ''), 'Client')
  INTO v_client_label
  FROM public.scheduled_visits sv
  INNER JOIN public.patients p ON p.id = sv.patient_id
  WHERE sv.id = v_schedule_id;

  SELECT cm.user_id
  INTO v_approved_user_id
  FROM public.caregiver_members cm
  WHERE cm.id = v_caregiver_id;

  IF v_approved_user_id IS NOT NULL THEN
    PERFORM public.notify_caregiver_user_in_app(
      v_approved_user_id,
      'Visit assignment approved: you were assigned to ' || v_client_label || '.'
    );
  END IF;

  v_superseded_title := 'Visit assignment closed: Another caregiver was selected for this visit with ' || v_client_label || '.';

  FOR r IN
    WITH declined_others AS (
      UPDATE public.schedule_assignment_requests
      SET status = 'declined',
          decline_reason = 'Another caregiver was assigned to this visit.',
          resolved_at = now(),
          resolved_by = auth.uid(),
          updated_at = now()
      WHERE schedule_id = v_schedule_id
        AND status = 'pending'
        AND id <> p_request_id
      RETURNING caregiver_member_id
    )
    SELECT caregiver_member_id FROM declined_others
  LOOP
    SELECT cm.user_id INTO v_other_user_id
    FROM public.caregiver_members cm
    WHERE cm.id = r.caregiver_member_id;

    IF v_other_user_id IS NOT NULL AND v_other_user_id IS DISTINCT FROM v_approved_user_id THEN
      PERFORM public.notify_caregiver_user_in_app(v_other_user_id, v_superseded_title);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_schedule_assignment_request(p_request_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule_id uuid;
  v_caregiver_member_id uuid;
  v_status text;
  v_patient_id uuid;
  v_updated int;
  v_reason text;
  v_client_label text;
  v_user_id uuid;
  v_title text;
  v_reason_excerpt text;
BEGIN
  v_reason := NULLIF(trim(COALESCE(p_reason, '')), '');

  SELECT sar.schedule_id, sar.caregiver_member_id, sar.status
  INTO v_schedule_id, v_caregiver_member_id, v_status
  FROM public.schedule_assignment_requests sar
  WHERE sar.id = p_request_id
  FOR UPDATE;

  IF v_schedule_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  SELECT sv.patient_id INTO v_patient_id
  FROM public.scheduled_visits sv
  WHERE sv.id = v_schedule_id;

  IF v_patient_id IS NULL OR NOT public.can_access_patient(v_patient_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT coalesce(nullif(trim(p.full_name), ''), 'Client')
  INTO v_client_label
  FROM public.scheduled_visits sv
  INNER JOIN public.patients p ON p.id = sv.patient_id
  WHERE sv.id = v_schedule_id;

  UPDATE public.schedule_assignment_requests
  SET status = 'declined',
      decline_reason = v_reason,
      resolved_at = now(),
      resolved_by = auth.uid(),
      updated_at = now()
  WHERE id = p_request_id
    AND status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  SELECT cm.user_id INTO v_user_id
  FROM public.caregiver_members cm
  WHERE cm.id = v_caregiver_member_id;

  v_reason_excerpt := coalesce(v_reason, 'No reason provided');
  IF length(v_reason_excerpt) > 200 THEN
    v_reason_excerpt := left(v_reason_excerpt, 197) || '...';
  END IF;

  v_title := 'Visit assignment declined for ' || v_client_label || ': ' || v_reason_excerpt;

  IF v_user_id IS NOT NULL THEN
    PERFORM public.notify_caregiver_user_in_app(v_user_id, v_title);
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_schedule_assignment_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decline_schedule_assignment_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_schedule_assignment_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_schedule_assignment_request(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.approve_schedule_assignment_request(uuid) IS
  'Coordinator approves assignment; notifies approved caregiver and others whose pending requests were superseded.';
COMMENT ON FUNCTION public.decline_schedule_assignment_request(uuid, text) IS
  'Coordinator declines assignment; notifies requesting caregiver with reason excerpt in title.';
