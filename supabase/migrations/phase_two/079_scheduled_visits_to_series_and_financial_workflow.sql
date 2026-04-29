-- Normalize recurrence and billing workflow away from scheduled_visits.
-- 1) Recurrence source of truth = visit_series
-- 2) Time/Billing workflow source = visit_financials.status + visit_approvals (approved rows)

-- -------------------------------------------------------------------
-- visit_financials: add workflow fields
-- -------------------------------------------------------------------
ALTER TABLE public.visit_financials
  ADD COLUMN IF NOT EXISTS service_type text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS coordinator_note text;

ALTER TABLE public.visit_financials
  DROP CONSTRAINT IF EXISTS visit_financials_status_check;

ALTER TABLE public.visit_financials
  ADD CONSTRAINT visit_financials_status_check
  CHECK (status IN ('pending', 'approved', 'voided'));

CREATE INDEX IF NOT EXISTS idx_visit_financials_status ON public.visit_financials(status);

-- -------------------------------------------------------------------
-- Recurrence backfill: ensure recurring visits point to visit_series
-- before repeat_* columns are dropped from scheduled_visits.
-- -------------------------------------------------------------------
WITH missing_series AS (
  SELECT
    sv.id AS visit_id,
    sv.agency_id,
    sv.patient_id,
    sv.caregiver_member_id,
    sv.contract_id,
    sv.service_type,
    sv.visit_type,
    sv.repeat_frequency,
    sv.days_of_week,
    COALESCE(sv.repeat_start, sv.visit_date) AS repeat_start,
    sv.repeat_end,
    sv.repeat_monthly_rules,
    sv.notes
  FROM public.scheduled_visits sv
  WHERE sv.is_recurring = true
    AND sv.visit_series_id IS NULL
    AND (
      sv.repeat_frequency IS NOT NULL
      OR sv.days_of_week IS NOT NULL
      OR sv.repeat_start IS NOT NULL
      OR sv.repeat_end IS NOT NULL
      OR sv.repeat_monthly_rules IS NOT NULL
    )
), inserted_series AS (
  INSERT INTO public.visit_series (
    agency_id,
    patient_id,
    primary_caregiver_member_id,
    contract_id,
    service_type,
    series_name,
    repeat_frequency,
    days_of_week,
    repeat_start,
    repeat_end,
    repeat_monthly_rules,
    notes,
    status
  )
  SELECT
    m.agency_id,
    m.patient_id,
    m.caregiver_member_id,
    m.contract_id,
    COALESCE(m.service_type, 'non_skilled'),
    m.visit_type,
    m.repeat_frequency,
    m.days_of_week,
    m.repeat_start,
    m.repeat_end,
    m.repeat_monthly_rules,
    m.notes,
    'active'
  FROM missing_series m
  RETURNING id, agency_id, patient_id, primary_caregiver_member_id, contract_id, service_type, repeat_start
), mapped AS (
  SELECT
    m.visit_id,
    i.id AS series_id
  FROM missing_series m
  JOIN inserted_series i
    ON i.agency_id = m.agency_id
   AND i.patient_id = m.patient_id
   AND i.primary_caregiver_member_id IS NOT DISTINCT FROM m.caregiver_member_id
   AND i.contract_id IS NOT DISTINCT FROM m.contract_id
   AND i.service_type = COALESCE(m.service_type, 'non_skilled')
   AND i.repeat_start = m.repeat_start
)
UPDATE public.scheduled_visits sv
SET visit_series_id = mapped.series_id,
    updated_at = now()
FROM mapped
WHERE sv.id = mapped.visit_id
  AND sv.visit_series_id IS NULL;

-- -------------------------------------------------------------------
-- Ensure time entries exist for completed + assigned visits (needed for financial rows)
-- -------------------------------------------------------------------
INSERT INTO public.visit_time_entries (
  agency_id,
  scheduled_visit_id,
  patient_id,
  caregiver_member_id,
  entry_status,
  actual_hours,
  billable_hours,
  created_at,
  updated_at
)
SELECT
  sv.agency_id,
  sv.id,
  sv.patient_id,
  sv.caregiver_member_id,
  CASE
    WHEN COALESCE(sv.billing_state, 'pending') = 'approved' THEN 'approved'
    ELSE 'submitted'
  END,
  CASE
    WHEN sv.scheduled_start_time IS NOT NULL AND sv.scheduled_end_time IS NOT NULL
      THEN round((extract(epoch FROM ((sv.visit_date + sv.scheduled_end_time)::timestamp - (sv.visit_date + sv.scheduled_start_time)::timestamp)) / 3600.0)::numeric, 2)
    ELSE NULL
  END,
  COALESCE(
    sv.billing_hours,
    CASE
      WHEN sv.scheduled_start_time IS NOT NULL AND sv.scheduled_end_time IS NOT NULL
        THEN round((extract(epoch FROM ((sv.visit_date + sv.scheduled_end_time)::timestamp - (sv.visit_date + sv.scheduled_start_time)::timestamp)) / 3600.0)::numeric, 2)
      ELSE NULL
    END
  ),
  now(),
  now()
FROM public.scheduled_visits sv
LEFT JOIN public.visit_time_entries vte ON vte.scheduled_visit_id = sv.id
WHERE sv.status = 'completed'
  AND sv.caregiver_member_id IS NOT NULL
  AND vte.id IS NULL;

-- -------------------------------------------------------------------
-- Backfill visit_financials from existing scheduled_visits billing_* data.
-- -------------------------------------------------------------------
INSERT INTO public.visit_financials (
  agency_id,
  scheduled_visit_id,
  visit_time_entry_id,
  visit_approval_id,
  patient_id,
  caregiver_member_id,
  contract_id,
  service_type,
  status,
  pay_rate,
  pay_amount,
  bill_rate,
  bill_amount,
  approved_actual_hours,
  approved_billable_hours,
  coordinator_note,
  calculation_basis,
  created_at,
  updated_at
)
SELECT
  sv.agency_id,
  sv.id,
  vte.id,
  va.id,
  sv.patient_id,
  sv.caregiver_member_id,
  sv.contract_id,
  COALESCE(sv.service_type, 'non_skilled'),
  CASE
    WHEN va.approval_status = 'approved' OR sv.billing_state = 'approved' THEN 'approved'
    WHEN sv.billing_state = 'voided' THEN 'voided'
    ELSE 'pending'
  END AS workflow_status,
  0,
  0,
  COALESCE(sv.billing_rate, 0),
  COALESCE(sv.billing_amount, 0),
  COALESCE(
    vte.actual_hours,
    CASE
      WHEN sv.scheduled_start_time IS NOT NULL AND sv.scheduled_end_time IS NOT NULL
        THEN round((extract(epoch FROM ((sv.visit_date + sv.scheduled_end_time)::timestamp - (sv.visit_date + sv.scheduled_start_time)::timestamp)) / 3600.0)::numeric, 2)
      ELSE NULL
    END
  ),
  COALESCE(
    vte.billable_hours,
    CASE
      WHEN sv.scheduled_start_time IS NOT NULL AND sv.scheduled_end_time IS NOT NULL
        THEN round((extract(epoch FROM ((sv.visit_date + sv.scheduled_end_time)::timestamp - (sv.visit_date + sv.scheduled_start_time)::timestamp)) / 3600.0)::numeric, 2)
      ELSE vte.actual_hours
    END
  ),
  sv.billing_note,
  jsonb_build_object('migrated_from_scheduled_visits', true, 'at', now()),
  now(),
  now()
FROM public.scheduled_visits sv
JOIN public.visit_time_entries vte ON vte.scheduled_visit_id = sv.id
LEFT JOIN public.visit_approvals va ON va.visit_time_entry_id = vte.id
WHERE sv.status = 'completed'
  AND sv.caregiver_member_id IS NOT NULL
ON CONFLICT (scheduled_visit_id) DO UPDATE
SET
  service_type = EXCLUDED.service_type,
  status = EXCLUDED.status,
  coordinator_note = EXCLUDED.coordinator_note,
  bill_rate = EXCLUDED.bill_rate,
  bill_amount = EXCLUDED.bill_amount,
  approved_actual_hours = EXCLUDED.approved_actual_hours,
  approved_billable_hours = EXCLUDED.approved_billable_hours,
  updated_at = now();

-- Keep financial rows linked to approved visit_approvals where available.
UPDATE public.visit_financials vf
SET visit_approval_id = va.id,
    status = 'approved',
    updated_at = now()
FROM public.visit_approvals va
WHERE va.scheduled_visit_id = vf.scheduled_visit_id
  AND va.approval_status = 'approved';

-- -------------------------------------------------------------------
-- Clock-out RPC: create pending financial row at completion.
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
  v_agency_id uuid;
  v_patient_id uuid;
  v_service_type text;
  v_in timestamptz;
  v_out timestamptz;
  v_hours numeric(10, 2);
  v_scheduled_hours numeric(10, 2);
  v_vte_id uuid;
BEGIN
  SELECT cm.id INTO v_cm_id
  FROM public.caregiver_members cm
  WHERE cm.user_id = auth.uid()
  LIMIT 1;

  IF v_cm_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_caregiver');
  END IF;

  SELECT sv.caregiver_member_id, sv.status, sv.agency_id, sv.patient_id, sv.service_type
  INTO v_assigned, v_status, v_agency_id, v_patient_id, v_service_type
  FROM public.scheduled_visits sv
  WHERE sv.id = p_scheduled_visit_id
  FOR UPDATE;

  IF v_assigned IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_assigned IS DISTINCT FROM v_cm_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT vte.id, vte.clock_in_time, vte.clock_out_time
  INTO v_vte_id, v_in, v_out
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
  SELECT
    CASE
      WHEN sv.scheduled_start_time IS NOT NULL AND sv.scheduled_end_time IS NOT NULL
        THEN round(
          (
            extract(
              epoch FROM (
                (sv.visit_date + sv.scheduled_end_time)::timestamp
                - (sv.visit_date + sv.scheduled_start_time)::timestamp
              )
            ) / 3600.0
          )::numeric,
          2
        )
      ELSE v_hours
    END
  INTO v_scheduled_hours
  FROM public.scheduled_visits sv
  WHERE sv.id = p_scheduled_visit_id;

  UPDATE public.visit_time_entries
  SET
    clock_out_time = v_out,
    clock_out_latitude = p_latitude,
    clock_out_longitude = p_longitude,
    actual_hours = v_hours,
    billable_hours = COALESCE(public.visit_time_entries.billable_hours, v_scheduled_hours),
    updated_at = now()
  WHERE scheduled_visit_id = p_scheduled_visit_id;

  UPDATE public.scheduled_visits
  SET status = 'completed', updated_at = now()
  WHERE id = p_scheduled_visit_id;

  INSERT INTO public.visit_financials (
    agency_id,
    scheduled_visit_id,
    visit_time_entry_id,
    patient_id,
    caregiver_member_id,
    service_type,
    status,
    pay_rate,
    pay_amount,
    bill_rate,
    bill_amount,
    approved_actual_hours,
    approved_billable_hours,
    calculation_basis,
    created_at,
    updated_at
  )
  VALUES (
    v_agency_id,
    p_scheduled_visit_id,
    v_vte_id,
    v_patient_id,
    v_cm_id,
    COALESCE(v_service_type, 'non_skilled'),
    'pending',
    0, 0, 0, 0,
    v_hours,
    v_scheduled_hours,
    jsonb_build_object('created_on_clock_out', true, 'at', now()),
    now(),
    now()
  )
  ON CONFLICT (scheduled_visit_id) DO UPDATE
  SET
    visit_time_entry_id = EXCLUDED.visit_time_entry_id,
    patient_id = EXCLUDED.patient_id,
    caregiver_member_id = EXCLUDED.caregiver_member_id,
    service_type = COALESCE(public.visit_financials.service_type, EXCLUDED.service_type),
    status = CASE
      WHEN public.visit_financials.status = 'approved' THEN public.visit_financials.status
      ELSE 'pending'
    END,
    approved_actual_hours = COALESCE(public.visit_financials.approved_actual_hours, EXCLUDED.approved_actual_hours),
    approved_billable_hours = COALESCE(public.visit_financials.approved_billable_hours, EXCLUDED.approved_billable_hours),
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.caregiver_clock_out_visit(uuid, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caregiver_clock_out_visit(uuid, double precision, double precision) TO authenticated;

-- -------------------------------------------------------------------
-- Drop legacy columns from scheduled_visits
-- -------------------------------------------------------------------
ALTER TABLE public.scheduled_visits
  DROP COLUMN IF EXISTS repeat_frequency,
  DROP COLUMN IF EXISTS days_of_week,
  DROP COLUMN IF EXISTS repeat_start,
  DROP COLUMN IF EXISTS repeat_end,
  DROP COLUMN IF EXISTS repeat_monthly_rules,
  DROP COLUMN IF EXISTS billing_state,
  DROP COLUMN IF EXISTS billing_hours,
  DROP COLUMN IF EXISTS billing_note,
  DROP COLUMN IF EXISTS billing_rate,
  DROP COLUMN IF EXISTS billing_amount,
  DROP COLUMN IF EXISTS created_by_user_id,
  DROP COLUMN IF EXISTS updated_by_user_id,
  DROP COLUMN IF EXISTS legacy_schedule_id,
  DROP COLUMN IF EXISTS status_backup_before_autosync,
  DROP COLUMN IF EXISTS visit_date_backup_before_utc,
  DROP COLUMN IF EXISTS scheduled_start_time_backup_before_utc,
  DROP COLUMN IF EXISTS scheduled_end_time_backup_before_utc;
