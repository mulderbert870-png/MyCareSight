-- Timeline-consistent status flow for patient_service_contracts:
-- - status in {active, scheduled, inactive}
-- - future-dated billing contracts are inserted as scheduled
-- - current active is preserved until scheduled row reaches effective date
-- - at most one active billing row per patient/service_type

-- Replace strict "single active" index with explicit name (keep same semantics).
DROP INDEX IF EXISTS public.ux_psc_one_active_billing_per_service_type;
CREATE UNIQUE INDEX IF NOT EXISTS ux_psc_one_active_billing_per_service_type
  ON public.patient_service_contracts (patient_id, service_type)
  WHERE status = 'active'
    AND contract_type <> 'weekly_hours';

-- Reconcile statuses for a patient based on today's date.
DROP FUNCTION IF EXISTS public.reconcile_patient_service_contract_statuses(uuid);

CREATE OR REPLACE FUNCTION public.reconcile_patient_service_contract_statuses(
  p_patient_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_service_type text;
  v_winner_id uuid;
BEGIN
  FOR v_service_type IN
    SELECT DISTINCT c.service_type
    FROM public.patient_service_contracts c
    WHERE c.patient_id = p_patient_id
      AND c.contract_type <> 'weekly_hours'
  LOOP
    UPDATE public.patient_service_contracts c
    SET
      status = 'scheduled',
      updated_at = now()
    WHERE c.patient_id = p_patient_id
      AND c.service_type = v_service_type
      AND c.contract_type <> 'weekly_hours'
      AND c.status = 'active'
      AND c.effective_date > current_date;

    SELECT c.id
      INTO v_winner_id
    FROM public.patient_service_contracts c
    WHERE c.patient_id = p_patient_id
      AND c.service_type = v_service_type
      AND c.contract_type <> 'weekly_hours'
      AND c.status IN ('active', 'scheduled')
      AND c.effective_date <= current_date
      AND (c.end_date IS NULL OR c.end_date >= current_date)
    ORDER BY c.effective_date DESC, c.created_at DESC, c.id DESC
    LIMIT 1;

    UPDATE public.patient_service_contracts c
    SET
      status = 'inactive',
      updated_at = now()
    WHERE c.patient_id = p_patient_id
      AND c.service_type = v_service_type
      AND c.contract_type <> 'weekly_hours'
      AND c.status = 'active'
      AND (v_winner_id IS NULL OR c.id <> v_winner_id);

    IF v_winner_id IS NOT NULL THEN
      UPDATE public.patient_service_contracts c
      SET
        status = 'active',
        updated_at = now()
      WHERE c.id = v_winner_id
        AND c.status <> 'active';
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_patient_service_contract_statuses(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_patient_service_contract_statuses(uuid) TO authenticated;

-- Replace insert helper: future rows become scheduled, not active.
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
  v_new_status text := 'active';
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

  IF p_contract_type <> 'weekly_hours' AND p_effective_date > current_date THEN
    v_new_status := 'scheduled';
  END IF;

  IF p_contract_type <> 'weekly_hours' AND v_new_status = 'active' THEN
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
    v_new_status,
    p_note
  )
  RETURNING id INTO v_new_id;

  IF p_contract_type <> 'weekly_hours' THEN
    PERFORM public.reconcile_patient_service_contract_statuses(p_patient_id);
  END IF;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.append_patient_service_contract(
  uuid, uuid, date, text, text, text, uuid, numeric, text, numeric, date, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_patient_service_contract(
  uuid, uuid, date, text, text, text, uuid, numeric, text, numeric, date, text
) TO authenticated;

-- Replace status setter: if "active" requested for future row, make it scheduled.
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

  IF v_status = 'active'
     AND v_target.contract_type <> 'weekly_hours'
     AND v_target.effective_date > current_date THEN
    v_status := 'scheduled';
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

  IF v_target.contract_type <> 'weekly_hours' THEN
    PERFORM public.reconcile_patient_service_contract_statuses(v_target.patient_id);
    SELECT *
      INTO v_updated
    FROM public.patient_service_contracts
    WHERE id = v_target.id;
  END IF;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.set_patient_service_contract_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_patient_service_contract_status(uuid, text) TO authenticated;
