-- Coordinator/caregiver workflow: requests to take an open schedule (visit) before caregiver_id is set.

CREATE TABLE IF NOT EXISTS public.schedule_assignment_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_id UUID NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  staff_member_id UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined')),
  caregiver_note TEXT,
  decline_reason TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX IF NOT EXISTS idx_schedule_assignment_requests_schedule_id
  ON public.schedule_assignment_requests(schedule_id);

CREATE INDEX IF NOT EXISTS idx_schedule_assignment_requests_staff_member_id
  ON public.schedule_assignment_requests(staff_member_id);

CREATE INDEX IF NOT EXISTS idx_schedule_assignment_requests_pending_schedule
  ON public.schedule_assignment_requests(schedule_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_assignment_requests_one_pending_per_pair
  ON public.schedule_assignment_requests(schedule_id, staff_member_id)
  WHERE status = 'pending';

CREATE TRIGGER update_schedule_assignment_requests_updated_at
  BEFORE UPDATE ON public.schedule_assignment_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.schedule_assignment_requests IS
  'Caregiver requests to be assigned to a schedule row; coordinator approves (sets schedules.caregiver_id) or declines.';

ALTER TABLE public.schedule_assignment_requests ENABLE ROW LEVEL SECURITY;

-- Read: agency staff (via patient) or the requesting caregiver.
DROP POLICY IF EXISTS "schedule_assignment_requests_select_accessible" ON public.schedule_assignment_requests;
CREATE POLICY "schedule_assignment_requests_select_accessible"
  ON public.schedule_assignment_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.schedules s
      WHERE s.id = schedule_id
        AND public.can_access_patient(s.patient_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.staff_members sm
      WHERE sm.id = staff_member_id
        AND sm.user_id = auth.uid()
    )
  );

-- Insert: logged-in caregiver, same agency as patient, open schedule, pending only.
DROP POLICY IF EXISTS "schedule_assignment_requests_insert_own_pending" ON public.schedule_assignment_requests;
CREATE POLICY "schedule_assignment_requests_insert_own_pending"
  ON public.schedule_assignment_requests
  FOR INSERT
  WITH CHECK (
    status = 'pending'
    AND EXISTS (
      SELECT 1
      FROM public.staff_members sm
      WHERE sm.id = staff_member_id
        AND sm.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM public.schedules s
      JOIN public.patients p ON p.id = s.patient_id
      WHERE s.id = schedule_id
        AND s.caregiver_id IS NULL
        AND p.agency_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.staff_members sm2
          WHERE sm2.id = staff_member_id
            AND sm2.agency_id = p.agency_id
        )
    )
  );

-- Coordinators / agency admins update request rows (optional path); RPC also used.
DROP POLICY IF EXISTS "schedule_assignment_requests_update_accessible" ON public.schedule_assignment_requests;
CREATE POLICY "schedule_assignment_requests_update_accessible"
  ON public.schedule_assignment_requests
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.schedules s
      WHERE s.id = schedule_id
        AND public.can_access_patient(s.patient_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.schedules s
      WHERE s.id = schedule_id
        AND public.can_access_patient(s.patient_id)
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.schedule_assignment_requests TO authenticated;

-- Approve: assign schedule, mark request approved, auto-decline other pending for same schedule.
CREATE OR REPLACE FUNCTION public.approve_schedule_assignment_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule_id uuid;
  v_staff_id uuid;
  v_status text;
  v_patient_id uuid;
  v_updated int;
BEGIN
  SELECT sar.schedule_id, sar.staff_member_id, sar.status
  INTO v_schedule_id, v_staff_id, v_status
  FROM public.schedule_assignment_requests sar
  WHERE sar.id = p_request_id
  FOR UPDATE;

  IF v_schedule_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  SELECT s.patient_id INTO v_patient_id
  FROM public.schedules s
  WHERE s.id = v_schedule_id;

  IF v_patient_id IS NULL OR NOT public.can_access_patient(v_patient_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  UPDATE public.schedules
  SET caregiver_id = v_staff_id,
      updated_at = now()
  WHERE id = v_schedule_id
    AND caregiver_id IS NULL;

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

  UPDATE public.schedule_assignment_requests
  SET status = 'declined',
      decline_reason = 'Another caregiver was assigned to this visit.',
      resolved_at = now(),
      resolved_by = auth.uid(),
      updated_at = now()
  WHERE schedule_id = v_schedule_id
    AND status = 'pending'
    AND id <> p_request_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Decline a single pending request (coordinator).
CREATE OR REPLACE FUNCTION public.decline_schedule_assignment_request(p_request_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule_id uuid;
  v_status text;
  v_patient_id uuid;
  v_updated int;
  v_reason text;
BEGIN
  v_reason := NULLIF(trim(COALESCE(p_reason, '')), '');

  SELECT sar.schedule_id, sar.status
  INTO v_schedule_id, v_status
  FROM public.schedule_assignment_requests sar
  WHERE sar.id = p_request_id
  FOR UPDATE;

  IF v_schedule_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  SELECT s.patient_id INTO v_patient_id
  FROM public.schedules s
  WHERE s.id = v_schedule_id;

  IF v_patient_id IS NULL OR NOT public.can_access_patient(v_patient_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

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

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_schedule_assignment_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decline_schedule_assignment_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_schedule_assignment_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_schedule_assignment_request(uuid, text) TO authenticated;
