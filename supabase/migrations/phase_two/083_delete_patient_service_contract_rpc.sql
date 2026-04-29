-- Safe delete RPC for patient_service_contracts.
-- Runs as definer so client can invoke via RPC even when direct DELETE policy is restrictive.
-- Reconciles status timeline after deletion.

DROP FUNCTION IF EXISTS public.delete_patient_service_contract(uuid);

CREATE OR REPLACE FUNCTION public.delete_patient_service_contract(
  p_contract_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target public.patient_service_contracts%ROWTYPE;
BEGIN
  SELECT *
    INTO v_target
  FROM public.patient_service_contracts
  WHERE id = p_contract_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract not found: %', p_contract_id;
  END IF;

  DELETE FROM public.patient_service_contracts
  WHERE id = p_contract_id;

  IF v_target.contract_type <> 'weekly_hours' THEN
    PERFORM public.reconcile_patient_service_contract_statuses(v_target.patient_id);
  END IF;

  RETURN p_contract_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_patient_service_contract(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_patient_service_contract(uuid) TO authenticated;
