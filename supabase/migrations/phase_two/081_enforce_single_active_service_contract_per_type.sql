-- Enforce one active billing contract per patient/service_type (skilled/non_skilled).
-- Weekly-hours rows are excluded from this rule.

-- 1) Data cleanup: if duplicates already exist, keep the newest active row per patient/service_type.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY patient_id, service_type
      ORDER BY effective_date DESC, created_at DESC, id DESC
    ) AS rn
  FROM public.patient_service_contracts
  WHERE contract_type <> 'weekly_hours'
    AND status = 'active'
)
UPDATE public.patient_service_contracts c
SET
  status = 'inactive',
  updated_at = now()
FROM ranked r
WHERE c.id = r.id
  AND r.rn > 1;

-- 2) Hard DB guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS ux_psc_one_active_billing_per_service_type
  ON public.patient_service_contracts (patient_id, service_type)
  WHERE status = 'active'
    AND contract_type <> 'weekly_hours';

-- 3) Insert helper: auto-deactivate other active billing rows for same patient/service_type.
CREATE OR REPLACE FUNCTION public.append_patient_service_contract(
  p_agency_id uuid,
  p_patient_id uuid,
  p_effective_date date,
  p_contract_name text DEFAULT NULL,
  p_contract_type text DEFAULT 'billing',
  p_service_type text DEFAULT 'non_skilled',
  p_billing_code_id uuid DEFAULT NULL,
  p_bill_rate numeric DEFAULT NULL,
  p_bill_unit_type text DEFAULT 'hour',
  p_weekly_hours_limit numeric DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_new_id uuid;
  v_next_start date;
  v_resolved_end date;
BEGIN
  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'effective_date is required';
  END IF;

  SELECT MIN(c.effective_date)
    INTO v_next_start
  FROM public.patient_service_contracts c
  WHERE c.patient_id = p_patient_id
    AND c.agency_id = p_agency_id
    AND c.contract_type = p_contract_type
    AND c.service_type = p_service_type
    AND c.effective_date > p_effective_date;

  IF p_end_date IS NULL THEN
    v_resolved_end := v_next_start;
  ELSIF v_next_start IS NULL THEN
    v_resolved_end := p_end_date;
  ELSE
    v_resolved_end := LEAST(p_end_date, v_next_start);
  END IF;

  UPDATE public.patient_service_contracts c
  SET
    end_date = p_effective_date,
    updated_at = now()
  WHERE c.id = (
    SELECT c2.id
    FROM public.patient_service_contracts c2
    WHERE c2.patient_id = p_patient_id
      AND c2.agency_id = p_agency_id
      AND c2.contract_type = p_contract_type
      AND c2.service_type = p_service_type
      AND c2.effective_date < p_effective_date
      AND (c2.end_date IS NULL OR c2.end_date > p_effective_date)
    ORDER BY c2.effective_date DESC
    LIMIT 1
  );

  IF p_contract_type <> 'weekly_hours' THEN
    UPDATE public.patient_service_contracts c
    SET
      status = 'inactive',
      updated_at = now()
    WHERE c.patient_id = p_patient_id
      AND c.agency_id = p_agency_id
      AND c.service_type = p_service_type
      AND c.contract_type <> 'weekly_hours'
      AND c.status = 'active';
  END IF;

  INSERT INTO public.patient_service_contracts (
    agency_id,
    patient_id,
    contract_name,
    contract_type,
    service_type,
    billing_code_id,
    bill_rate,
    bill_unit_type,
    weekly_hours_limit,
    effective_date,
    end_date,
    status,
    note
  )
  VALUES (
    p_agency_id,
    p_patient_id,
    p_contract_name,
    p_contract_type,
    p_service_type,
    p_billing_code_id,
    p_bill_rate,
    p_bill_unit_type,
    p_weekly_hours_limit,
    p_effective_date,
    v_resolved_end,
    'active',
    p_note
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.append_patient_service_contract(
  uuid, uuid, date, text, text, text, uuid, numeric, text, numeric, date, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_patient_service_contract(
  uuid, uuid, date, text, text, text, uuid, numeric, text, numeric, date, text
) TO authenticated;

-- 4) Status setter used by UI: activating one row auto-deactivates siblings.
DROP FUNCTION IF EXISTS public.set_patient_service_contract_status(uuid, text);

CREATE OR REPLACE FUNCTION public.set_patient_service_contract_status(
  p_contract_id uuid,
  p_status text
) RETURNS public.patient_service_contracts
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_target public.patient_service_contracts%ROWTYPE;
  v_status text;
  v_updated public.patient_service_contracts%ROWTYPE;
BEGIN
  SELECT *
    INTO v_target
  FROM public.patient_service_contracts
  WHERE id = p_contract_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract not found: %', p_contract_id;
  END IF;

  v_status := lower(coalesce(trim(p_status), ''));
  IF v_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
  END IF;

  IF v_status = 'active' AND v_target.contract_type <> 'weekly_hours' THEN
    UPDATE public.patient_service_contracts c
    SET
      status = 'inactive',
      updated_at = now()
    WHERE c.patient_id = v_target.patient_id
      AND c.service_type = v_target.service_type
      AND c.contract_type <> 'weekly_hours'
      AND c.status = 'active'
      AND c.id <> v_target.id;
  END IF;

  UPDATE public.patient_service_contracts c
  SET
    status = v_status,
    updated_at = now()
  WHERE c.id = v_target.id
  RETURNING * INTO v_updated;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.set_patient_service_contract_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_patient_service_contract_status(uuid, text) TO authenticated;
