-- Notify agency admins/care coordinators when a caregiver asks to be removed from a visit.

CREATE OR REPLACE FUNCTION public.notify_agency_staff_schedule_unassignment_request(
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

  v_title := v_name || ' requested unassignment from an assigned visit';

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

REVOKE ALL ON FUNCTION public.notify_agency_staff_schedule_unassignment_request(uuid, uuid) FROM PUBLIC;

COMMENT ON FUNCTION public.notify_agency_staff_schedule_unassignment_request(uuid, uuid) IS
  'Creates one in-app notification per agency admin and care coordinator when a caregiver submits an unassignment request.';

CREATE OR REPLACE FUNCTION public.submit_schedule_unassignment_request (p_schedule_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_cm_id uuid;
  v_agency_id uuid;
BEGIN
  IF auth.uid () IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'not_authenticated');
  END IF;

  SELECT
    cm.id,
    sv.agency_id INTO v_cm_id,
    v_agency_id
  FROM
    public.scheduled_visits sv
    INNER JOIN public.caregiver_members cm ON cm.user_id = auth.uid ()
  WHERE
    sv.id = p_schedule_id
    AND sv.caregiver_member_id = cm.id
    AND sv.agency_id IS NOT NULL
    AND (
      (cm.agency_id IS NOT NULL
        AND cm.agency_id = sv.agency_id)
      OR (cm.agency_id IS NULL
        AND EXISTS (
          SELECT
            1
          FROM
            public.agency_admins aa
          WHERE
            aa.agency_id = sv.agency_id
            AND aa.id = cm.company_owner_id))
    )
  LIMIT 1;

  IF v_cm_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'cannot_request');
  END IF;

  INSERT INTO public.schedule_unassignment_requests (schedule_id, caregiver_member_id, status)
    VALUES (p_schedule_id, v_cm_id, 'pending');

  PERFORM public.notify_agency_staff_schedule_unassignment_request(v_agency_id, v_cm_id);

  RETURN jsonb_build_object('ok', TRUE);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'duplicate_pending');
END;
$$;

REVOKE ALL ON FUNCTION public.submit_schedule_unassignment_request (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_schedule_unassignment_request (uuid) TO authenticated;

COMMENT ON FUNCTION public.submit_schedule_unassignment_request (uuid) IS
  'Assigned caregiver submits a pending unassignment request and notifies agency admins/coordinators.';
