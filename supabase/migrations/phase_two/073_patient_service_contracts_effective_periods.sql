-- Timeline insert helper for patient_service_contracts.
-- When inserting a new effective_date inside existing history, it will:
-- 1) close the previous overlapping row at the new effective_date
-- 2) set the new row end_date to the next future effective_date (unless earlier explicit end_date)
--
-- Required parameters must precede any with DEFAULT (PostgreSQL 42P13 otherwise).

DROP FUNCTION IF EXISTS public.append_patient_service_contract(
  uuid, uuid, text, text, text, uuid, numeric, text, numeric, date, date, text
);

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

