-- Caregiver-initiated unassignment: coordinator approves (clears caregiver on visit) or declines.

CREATE TABLE IF NOT EXISTS public.schedule_unassignment_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_id uuid NOT NULL REFERENCES public.scheduled_visits (id) ON DELETE CASCADE,
  caregiver_member_id uuid NOT NULL REFERENCES public.caregiver_members (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text])),
  decline_reason text,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_unassignment_requests_one_pending_per_pair
  ON public.schedule_unassignment_requests (schedule_id, caregiver_member_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_schedule_unassignment_requests_pending_schedule
  ON public.schedule_unassignment_requests (schedule_id)
  WHERE status = 'pending';

CREATE TRIGGER update_schedule_unassignment_requests_updated_at
  BEFORE UPDATE ON public.schedule_unassignment_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.schedule_unassignment_requests IS
  'Caregiver requests to be removed from an assigned visit; coordinator approves (clears caregiver_member_id) or declines.';

ALTER TABLE public.schedule_unassignment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "schedule_unassignment_requests_select" ON public.schedule_unassignment_requests;
CREATE POLICY "schedule_unassignment_requests_select"
  ON public.schedule_unassignment_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.scheduled_visits sv
      WHERE sv.id = schedule_id
        AND public.can_access_patient (sv.patient_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.caregiver_members cm
      WHERE cm.id = caregiver_member_id
        AND cm.user_id = auth.uid()
    )
  );

GRANT SELECT ON public.schedule_unassignment_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_schedule_unassignment_request (p_schedule_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_cm_id uuid;
BEGIN
  IF auth.uid () IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'not_authenticated');
  END IF;

  SELECT
    cm.id INTO v_cm_id
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

  RETURN jsonb_build_object('ok', TRUE);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'duplicate_pending');
END;
$$;

REVOKE ALL ON FUNCTION public.submit_schedule_unassignment_request (uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_schedule_unassignment_request (uuid) TO authenticated;

COMMENT ON FUNCTION public.submit_schedule_unassignment_request (uuid) IS
  'Assigned caregiver submits a pending unassignment request (SECURITY DEFINER).';

CREATE OR REPLACE FUNCTION public.approve_schedule_unassignment_request (p_request_id uuid)
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
  v_user_id uuid;
BEGIN
  SELECT
    sur.schedule_id,
    sur.caregiver_member_id,
    sur.status INTO v_schedule_id,
    v_caregiver_id,
    v_status
  FROM
    public.schedule_unassignment_requests sur
  WHERE
    sur.id = p_request_id
  FOR UPDATE;

  IF v_schedule_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'not_found');
  END IF;

  IF v_status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'not_pending');
  END IF;

  SELECT
    sv.patient_id INTO v_patient_id
  FROM
    public.scheduled_visits sv
  WHERE
    sv.id = v_schedule_id;

  IF v_patient_id IS NULL OR NOT public.can_access_patient (v_patient_id) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'forbidden');
  END IF;

  UPDATE
    public.scheduled_visits
  SET
    caregiver_member_id = NULL,
    updated_at = now()
  WHERE
    id = v_schedule_id
    AND caregiver_member_id = v_caregiver_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'visit_changed');
  END IF;

  UPDATE
    public.schedule_unassignment_requests
  SET
    status = 'approved',
    resolved_at = now(),
    resolved_by = auth.uid (),
    updated_at = now()
  WHERE
    id = p_request_id;

  SELECT
    coalesce(nullif(trim(p.full_name), ''), 'Client') INTO v_client_label
  FROM
    public.scheduled_visits sv
    INNER JOIN public.patients p ON p.id = sv.patient_id
  WHERE
    sv.id = v_schedule_id;

  SELECT
    cm.user_id INTO v_user_id
  FROM
    public.caregiver_members cm
  WHERE
    cm.id = v_caregiver_id;

  IF v_user_id IS NOT NULL THEN
    PERFORM
      public.notify_caregiver_user_in_app (v_user_id, 'Unassignment approved: you were removed from the visit for ' || v_client_label || '.');
  END IF;

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_schedule_unassignment_request (uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.approve_schedule_unassignment_request (uuid) TO authenticated;

COMMENT ON FUNCTION public.approve_schedule_unassignment_request (uuid) IS
  'Coordinator approves unassignment; clears caregiver on scheduled_visits and notifies caregiver.';

CREATE OR REPLACE FUNCTION public.decline_schedule_unassignment_request (p_request_id uuid, p_reason text)
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

  SELECT
    sur.schedule_id,
    sur.caregiver_member_id,
    sur.status INTO v_schedule_id,
    v_caregiver_member_id,
    v_status
  FROM
    public.schedule_unassignment_requests sur
  WHERE
    sur.id = p_request_id
  FOR UPDATE;

  IF v_schedule_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'not_found');
  END IF;

  IF v_status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'not_pending');
  END IF;

  SELECT
    sv.patient_id INTO v_patient_id
  FROM
    public.scheduled_visits sv
  WHERE
    sv.id = v_schedule_id;

  IF v_patient_id IS NULL OR NOT public.can_access_patient (v_patient_id) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'forbidden');
  END IF;

  SELECT
    coalesce(nullif(trim(p.full_name), ''), 'Client') INTO v_client_label
  FROM
    public.scheduled_visits sv
    INNER JOIN public.patients p ON p.id = sv.patient_id
  WHERE
    sv.id = v_schedule_id;

  UPDATE
    public.schedule_unassignment_requests
  SET
    status = 'declined',
    decline_reason = v_reason,
    resolved_at = now(),
    resolved_by = auth.uid (),
    updated_at = now()
  WHERE
    id = p_request_id
    AND status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'not_pending');
  END IF;

  SELECT
    cm.user_id INTO v_user_id
  FROM
    public.caregiver_members cm
  WHERE
    cm.id = v_caregiver_member_id;

  v_reason_excerpt := coalesce(v_reason, 'No reason provided');

  IF length(v_reason_excerpt) > 200 THEN
    v_reason_excerpt := left(v_reason_excerpt, 197) || '...';
  END IF;

  v_title := 'Unassignment declined for ' || v_client_label || ': ' || v_reason_excerpt;

  IF v_user_id IS NOT NULL THEN
    PERFORM
      public.notify_caregiver_user_in_app (v_user_id, v_title);
  END IF;

  RETURN jsonb_build_object('ok', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.decline_schedule_unassignment_request (uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.decline_schedule_unassignment_request (uuid, text) TO authenticated;

COMMENT ON FUNCTION public.decline_schedule_unassignment_request (uuid, text) IS
  'Coordinator declines unassignment request; notifies caregiver.';
