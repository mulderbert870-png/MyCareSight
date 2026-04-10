-- EVV clock in/out coordinates, caregiver session notes, per-task completion on scheduled_visit_tasks.
-- SECURITY DEFINER RPCs enforce assigned caregiver; avoids widening scheduled_visit_tasks UPDATE RLS.

ALTER TABLE public.visit_time_entries
  ADD COLUMN IF NOT EXISTS clock_in_latitude double precision,
  ADD COLUMN IF NOT EXISTS clock_in_longitude double precision,
  ADD COLUMN IF NOT EXISTS clock_out_latitude double precision,
  ADD COLUMN IF NOT EXISTS clock_out_longitude double precision,
  ADD COLUMN IF NOT EXISTS caregiver_notes text;

ALTER TABLE public.scheduled_visit_tasks
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

COMMENT ON COLUMN public.visit_time_entries.clock_in_latitude IS 'EVV: GPS latitude at clock in.';
COMMENT ON COLUMN public.visit_time_entries.clock_in_longitude IS 'EVV: GPS longitude at clock in.';
COMMENT ON COLUMN public.scheduled_visit_tasks.completed_at IS 'Set when assigned caregiver marks task done during visit.';

-- -------------------------------------------------------------------
-- caregiver_clock_in_visit
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.caregiver_clock_in_visit(
  p_scheduled_visit_id uuid,
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cm_id uuid;
  v_agency_id uuid;
  v_patient_id uuid;
  v_assigned uuid;
  v_status text;
BEGIN
  SELECT cm.id INTO v_cm_id
  FROM public.caregiver_members cm
  WHERE cm.user_id = auth.uid()
  LIMIT 1;

  IF v_cm_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_caregiver');
  END IF;

  SELECT sv.agency_id, sv.patient_id, sv.caregiver_member_id, sv.status
  INTO v_agency_id, v_patient_id, v_assigned, v_status
  FROM public.scheduled_visits sv
  WHERE sv.id = p_scheduled_visit_id
  FOR UPDATE;

  IF v_agency_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_assigned IS DISTINCT FROM v_cm_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF lower(coalesce(v_status, '')) IN ('completed', 'missed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'visit_closed');
  END IF;

  UPDATE public.scheduled_visits
  SET status = 'in_progress', updated_at = now()
  WHERE id = p_scheduled_visit_id;

  INSERT INTO public.visit_time_entries (
    agency_id,
    scheduled_visit_id,
    patient_id,
    caregiver_member_id,
    clock_in_time,
    clock_in_latitude,
    clock_in_longitude,
    entry_status
  ) VALUES (
    v_agency_id,
    p_scheduled_visit_id,
    v_patient_id,
    v_cm_id,
    now(),
    p_latitude,
    p_longitude,
    'pending_review'
  )
  ON CONFLICT (scheduled_visit_id) DO UPDATE SET
    clock_in_time = COALESCE(public.visit_time_entries.clock_in_time, excluded.clock_in_time),
    clock_in_latitude = COALESCE(public.visit_time_entries.clock_in_latitude, excluded.clock_in_latitude),
    clock_in_longitude = COALESCE(public.visit_time_entries.clock_in_longitude, excluded.clock_in_longitude),
    caregiver_member_id = excluded.caregiver_member_id,
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.caregiver_clock_in_visit(uuid, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caregiver_clock_in_visit(uuid, double precision, double precision) TO authenticated;

-- -------------------------------------------------------------------
-- caregiver_clock_out_visit
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.caregiver_clock_out_visit(
  p_scheduled_visit_id uuid,
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cm_id uuid;
  v_assigned uuid;
  v_status text;
  v_in timestamptz;
  v_out timestamptz;
  v_hours numeric(10, 2);
BEGIN
  SELECT cm.id INTO v_cm_id
  FROM public.caregiver_members cm
  WHERE cm.user_id = auth.uid()
  LIMIT 1;

  IF v_cm_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_caregiver');
  END IF;

  SELECT sv.caregiver_member_id, sv.status
  INTO v_assigned, v_status
  FROM public.scheduled_visits sv
  WHERE sv.id = p_scheduled_visit_id
  FOR UPDATE;

  IF v_assigned IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_assigned IS DISTINCT FROM v_cm_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT vte.clock_in_time, vte.clock_out_time
  INTO v_in, v_out
  FROM public.visit_time_entries vte
  WHERE vte.scheduled_visit_id = p_scheduled_visit_id
  FOR UPDATE;

  IF v_in IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_clocked_in');
  END IF;

  IF v_out IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_clocked_out', true);
  END IF;

  v_out := now();
  v_hours := round((extract(epoch FROM (v_out - v_in)) / 3600.0)::numeric, 2);

  UPDATE public.visit_time_entries
  SET
    clock_out_time = v_out,
    clock_out_latitude = p_latitude,
    clock_out_longitude = p_longitude,
    actual_hours = v_hours,
    billable_hours = COALESCE(public.visit_time_entries.billable_hours, v_hours),
    updated_at = now()
  WHERE scheduled_visit_id = p_scheduled_visit_id;

  UPDATE public.scheduled_visits
  SET status = 'completed', updated_at = now()
  WHERE id = p_scheduled_visit_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.caregiver_clock_out_visit(uuid, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caregiver_clock_out_visit(uuid, double precision, double precision) TO authenticated;

-- -------------------------------------------------------------------
-- caregiver_set_scheduled_visit_task_completed
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.caregiver_set_scheduled_visit_task_completed(
  p_scheduled_visit_task_id uuid,
  p_completed boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cm_id uuid;
  v_updated int;
BEGIN
  SELECT cm.id INTO v_cm_id
  FROM public.caregiver_members cm
  WHERE cm.user_id = auth.uid()
  LIMIT 1;

  IF v_cm_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_caregiver');
  END IF;

  UPDATE public.scheduled_visit_tasks svt
  SET
    completed_at = CASE WHEN p_completed THEN now() ELSE NULL END,
    updated_at = now()
  FROM public.scheduled_visits sv
  WHERE svt.id = p_scheduled_visit_task_id
    AND sv.id = svt.scheduled_visit_id
    AND sv.caregiver_member_id = v_cm_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found_or_forbidden');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.caregiver_set_scheduled_visit_task_completed(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caregiver_set_scheduled_visit_task_completed(uuid, boolean) TO authenticated;
