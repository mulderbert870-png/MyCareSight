-- Versioned caregiver pay rates (effective date ranges). Append-only semantics: closing
-- the previous open row and inserting the new row share the same transition date.

CREATE TABLE IF NOT EXISTS public.caregiver_pay_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  caregiver_member_id uuid NOT NULL REFERENCES public.caregiver_members(id) ON DELETE CASCADE,
  pay_rate numeric(10, 2) NOT NULL,
  effective_start date NOT NULL,
  effective_end date,
  unit_type text NOT NULL DEFAULT 'hour',
  service_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caregiver_pay_rates_unit_type_check
    CHECK (unit_type IN ('hour', 'visit', '15_min_unit'))
);

CREATE INDEX IF NOT EXISTS idx_caregiver_pay_rates_agency_id ON public.caregiver_pay_rates(agency_id);
CREATE INDEX IF NOT EXISTS idx_caregiver_pay_rates_caregiver_member_id ON public.caregiver_pay_rates(caregiver_member_id);
CREATE INDEX IF NOT EXISTS idx_caregiver_pay_rates_effective ON public.caregiver_pay_rates(caregiver_member_id, effective_start);

DROP TRIGGER IF EXISTS trg_caregiver_pay_rates_updated_at ON public.caregiver_pay_rates;
CREATE TRIGGER trg_caregiver_pay_rates_updated_at
  BEFORE UPDATE ON public.caregiver_pay_rates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.caregiver_pay_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "caregiver_pay_rates_select" ON public.caregiver_pay_rates;
CREATE POLICY "caregiver_pay_rates_select"
  ON public.caregiver_pay_rates FOR SELECT
  TO authenticated
  USING (public.hs_can_access_agency(agency_id));

DROP POLICY IF EXISTS "caregiver_pay_rates_insert" ON public.caregiver_pay_rates;
CREATE POLICY "caregiver_pay_rates_insert"
  ON public.caregiver_pay_rates FOR INSERT
  TO authenticated
  WITH CHECK (public.hs_can_manage_agency(agency_id));

DROP POLICY IF EXISTS "caregiver_pay_rates_update" ON public.caregiver_pay_rates;
CREATE POLICY "caregiver_pay_rates_update"
  ON public.caregiver_pay_rates FOR UPDATE
  TO authenticated
  USING (public.hs_can_manage_agency(agency_id))
  WITH CHECK (public.hs_can_manage_agency(agency_id));

DROP POLICY IF EXISTS "caregiver_pay_rates_delete" ON public.caregiver_pay_rates;
CREATE POLICY "caregiver_pay_rates_delete"
  ON public.caregiver_pay_rates FOR DELETE
  TO authenticated
  USING (public.hs_is_agency_admin(agency_id));

COMMENT ON TABLE public.caregiver_pay_rates IS
  'Historical caregiver pay rates. On change, set prior open row effective_end and insert a new row with the same effective date as effective_start.';

-- Atomic close-open for one caregiver + optional service_type band (NULL = default / all service types).
CREATE OR REPLACE FUNCTION public.append_caregiver_pay_rate(
  p_caregiver_member_id uuid,
  p_agency_id uuid,
  p_pay_rate numeric,
  p_effective date,
  p_service_type text DEFAULT NULL,
  p_unit_type text DEFAULT 'hour'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_new_id uuid;
  v_unit text;
  v_next_start date;
BEGIN
  IF p_pay_rate IS NULL OR p_pay_rate < 0 THEN
    RAISE EXCEPTION 'Invalid pay rate';
  END IF;
  IF p_effective IS NULL THEN
    RAISE EXCEPTION 'Effective date required';
  END IF;

  v_unit := COALESCE(NULLIF(trim(p_unit_type), ''), 'hour');
  IF v_unit NOT IN ('hour', 'visit', '15_min_unit') THEN
    RAISE EXCEPTION 'Invalid unit_type';
  END IF;

  -- Timeline insertion behavior:
  -- 1) Close the active/overlapping "previous" row at p_effective.
  -- 2) End the newly inserted row at the next known effective_start (if any).
  -- This supports back-dated inserts (e.g. add Apr-02 when Apr-05 already exists).
  SELECT MIN(c.effective_start)
    INTO v_next_start
  FROM public.caregiver_pay_rates c
  WHERE c.caregiver_member_id = p_caregiver_member_id
    AND c.agency_id = p_agency_id
    AND (c.service_type IS NOT DISTINCT FROM p_service_type)
    AND c.effective_start > p_effective;

  UPDATE public.caregiver_pay_rates c
  SET
    effective_end = p_effective,
    updated_at = now()
  WHERE c.id = (
    SELECT c2.id
    FROM public.caregiver_pay_rates c2
    WHERE c2.caregiver_member_id = p_caregiver_member_id
      AND c2.agency_id = p_agency_id
      AND (c2.service_type IS NOT DISTINCT FROM p_service_type)
      AND c2.effective_start < p_effective
      AND (c2.effective_end IS NULL OR c2.effective_end > p_effective)
    ORDER BY c2.effective_start DESC
    LIMIT 1
  );

  INSERT INTO public.caregiver_pay_rates (
    agency_id,
    caregiver_member_id,
    pay_rate,
    effective_start,
    effective_end,
    unit_type,
    service_type
  )
  VALUES (
    p_agency_id,
    p_caregiver_member_id,
    p_pay_rate,
    p_effective,
    v_next_start,
    v_unit,
    p_service_type
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.append_caregiver_pay_rate(uuid, uuid, numeric, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_caregiver_pay_rate(uuid, uuid, numeric, date, text, text) TO authenticated;

-- Backfill from legacy pay_rate_schedule rows (caregiver-only, no credential/task).
INSERT INTO public.caregiver_pay_rates (
  agency_id,
  caregiver_member_id,
  pay_rate,
  effective_start,
  effective_end,
  unit_type,
  service_type,
  created_at,
  updated_at
)
SELECT
  prs.agency_id,
  prs.caregiver_member_id,
  prs.rate,
  prs.effective_start,
  prs.effective_end,
  prs.unit_type,
  prs.service_type,
  COALESCE(prs.created_at, now()),
  COALESCE(prs.updated_at, now())
FROM public.pay_rate_schedule prs
WHERE prs.caregiver_member_id IS NOT NULL
  AND prs.credential_id IS NULL
  AND prs.task_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.caregiver_pay_rates c
    WHERE c.caregiver_member_id = prs.caregiver_member_id
      AND c.agency_id = prs.agency_id
      AND c.effective_start IS NOT DISTINCT FROM prs.effective_start
      AND c.pay_rate IS NOT DISTINCT FROM prs.rate
      AND (c.service_type IS NOT DISTINCT FROM prs.service_type)
  );
