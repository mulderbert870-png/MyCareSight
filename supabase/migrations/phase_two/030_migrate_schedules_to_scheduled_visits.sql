-- Migrate legacy public.schedules into HomeSight scheduled_visits (+ tasks), repoint
-- schedule_assignment_requests FK, update RPCs/policies, and add recurrence columns on
-- scheduled_visits so existing UI fields (is_recurring, repeat_*) keep working without visit_series.

-- -------------------------------------------------------------------
-- 1) Bridge columns on scheduled_visits (parity with old schedules row shape)
-- -------------------------------------------------------------------
ALTER TABLE public.scheduled_visits
  ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT false;

ALTER TABLE public.scheduled_visits
  ADD COLUMN IF NOT EXISTS repeat_frequency text;

ALTER TABLE public.scheduled_visits
  ADD COLUMN IF NOT EXISTS days_of_week smallint[];

ALTER TABLE public.scheduled_visits
  ADD COLUMN IF NOT EXISTS repeat_start date;

ALTER TABLE public.scheduled_visits
  ADD COLUMN IF NOT EXISTS repeat_end date;

ALTER TABLE public.scheduled_visits
  ADD COLUMN IF NOT EXISTS repeat_monthly_rules jsonb;

-- -------------------------------------------------------------------
-- 2) Copy schedule rows → scheduled_visits (preserve id for FK continuity)
-- -------------------------------------------------------------------
INSERT INTO public.scheduled_visits (
  id,
  agency_id,
  visit_series_id,
  patient_id,
  staff_member_id,
  contract_id,
  service_type,
  visit_date,
  scheduled_start_time,
  scheduled_end_time,
  description,
  notes,
  visit_type,
  status,
  created_by_user_id,
  updated_by_user_id,
  legacy_schedule_id,
  is_recurring,
  repeat_frequency,
  days_of_week,
  repeat_start,
  repeat_end,
  repeat_monthly_rules,
  created_at,
  updated_at
)
SELECT
  s.id,
  p.agency_id,
  NULL::uuid,
  s.patient_id,
  s.caregiver_id,
  NULL::uuid,
  'non_skilled'::text,
  s.date,
  s.start_time,
  s.end_time,
  s.description,
  s.notes,
  s.type,
  COALESCE(NULLIF(trim(s.status), ''), 'scheduled'),
  NULL::uuid,
  NULL::uuid,
  s.id,
  COALESCE(s.is_recurring, false),
  s.repeat_frequency,
  CASE
    WHEN s.days_of_week IS NULL THEN NULL::smallint[]
    ELSE s.days_of_week::smallint[]
  END,
  s.repeat_start,
  s.repeat_end,
  COALESCE(s.repeat_monthly_rules, '[]'::jsonb),
  s.created_at,
  s.updated_at
FROM public.schedules s
INNER JOIN public.patients p ON p.id = s.patient_id
WHERE p.agency_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- -------------------------------------------------------------------
-- 3) ADL / task tokens → scheduled_visit_tasks (only visits with no tasks yet)
-- -------------------------------------------------------------------
INSERT INTO public.scheduled_visit_tasks (
  agency_id,
  scheduled_visit_id,
  task_id,
  legacy_task_code,
  sort_order,
  created_at,
  updated_at
)
SELECT
  sv.agency_id,
  sv.id,
  NULL::uuid,
  NULLIF(trim(both from t.code), ''),
  (t.ord - 1)::int,
  now(),
  now()
FROM public.scheduled_visits sv
INNER JOIN public.schedules s ON s.id = sv.id
CROSS JOIN LATERAL unnest(COALESCE(s.adl_codes, '{}'::text[])) WITH ORDINALITY AS t(code, ord)
WHERE sv.legacy_schedule_id IS NOT NULL
  AND NULLIF(trim(both from t.code), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.scheduled_visit_tasks existing
    WHERE existing.scheduled_visit_id = sv.id
  );

-- -------------------------------------------------------------------
-- 4) Point schedule_assignment_requests at scheduled_visits
-- -------------------------------------------------------------------
-- Drop requests tied to visits we did not migrate (e.g. patient had no agency_id).
DELETE FROM public.schedule_assignment_requests sar
WHERE NOT EXISTS (
  SELECT 1 FROM public.scheduled_visits sv WHERE sv.id = sar.schedule_id
);

ALTER TABLE public.schedule_assignment_requests
  DROP CONSTRAINT IF EXISTS schedule_assignment_requests_schedule_id_fkey;

ALTER TABLE public.schedule_assignment_requests
  ADD CONSTRAINT schedule_assignment_requests_schedule_id_fkey
  FOREIGN KEY (schedule_id)
  REFERENCES public.scheduled_visits(id)
  ON DELETE CASCADE;

-- -------------------------------------------------------------------
-- 5) RLS policies: join scheduled_visits instead of schedules
-- -------------------------------------------------------------------
DROP POLICY IF EXISTS "schedule_assignment_requests_select_accessible" ON public.schedule_assignment_requests;
CREATE POLICY "schedule_assignment_requests_select_accessible"
  ON public.schedule_assignment_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.scheduled_visits sv
      WHERE sv.id = schedule_id
        AND public.can_access_patient(sv.patient_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.staff_members sm
      WHERE sm.id = staff_member_id
        AND sm.user_id = auth.uid()
    )
  );

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
      FROM public.scheduled_visits sv
      JOIN public.patients p ON p.id = sv.patient_id
      WHERE sv.id = schedule_id
        AND sv.staff_member_id IS NULL
        AND p.agency_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.staff_members sm2
          WHERE sm2.id = staff_member_id
            AND sm2.agency_id = p.agency_id
        )
    )
  );

DROP POLICY IF EXISTS "schedule_assignment_requests_update_accessible" ON public.schedule_assignment_requests;
CREATE POLICY "schedule_assignment_requests_update_accessible"
  ON public.schedule_assignment_requests
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.scheduled_visits sv
      WHERE sv.id = schedule_id
        AND public.can_access_patient(sv.patient_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.scheduled_visits sv
      WHERE sv.id = schedule_id
        AND public.can_access_patient(sv.patient_id)
    )
  );

-- -------------------------------------------------------------------
-- 6) RPC: assign staff_member_id on scheduled_visits (was caregiver_id on schedules)
-- -------------------------------------------------------------------
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

  SELECT sv.patient_id INTO v_patient_id
  FROM public.scheduled_visits sv
  WHERE sv.id = v_schedule_id;

  IF v_patient_id IS NULL OR NOT public.can_access_patient(v_patient_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  UPDATE public.scheduled_visits
  SET staff_member_id = v_staff_id,
      updated_at = now()
  WHERE id = v_schedule_id
    AND staff_member_id IS NULL;

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

  SELECT sv.patient_id INTO v_patient_id
  FROM public.scheduled_visits sv
  WHERE sv.id = v_schedule_id;

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

COMMENT ON TABLE public.schedule_assignment_requests IS
  'Caregiver requests to be assigned to a visit; coordinator approves (sets scheduled_visits.staff_member_id) or declines.';
