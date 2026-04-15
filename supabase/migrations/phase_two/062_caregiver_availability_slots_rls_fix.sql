-- Fix RLS on caregiver_availability_slots: previous INSERT policy used
-- `agency_id IN (SELECT cm.agency_id FROM caregiver_members WHERE user_id = auth.uid())`
-- which fails when agency_id is NULL (NULL IN (...) / = semantics) or when the
-- client-sent agency_id does not exactly match the member row.
-- Sync agency_id from caregiver_members in a BEFORE trigger, then enforce only
-- caregiver_member_id = own row.

CREATE OR REPLACE FUNCTION public.caregiver_availability_slots_sync_agency_from_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_agency uuid;
BEGIN
  SELECT cm.agency_id INTO v_agency
  FROM public.caregiver_members cm
  WHERE cm.id = NEW.caregiver_member_id;

  NEW.agency_id := v_agency;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_caregiver_availability_slots_sync_agency ON public.caregiver_availability_slots;
CREATE TRIGGER trg_caregiver_availability_slots_sync_agency
  BEFORE INSERT OR UPDATE
  ON public.caregiver_availability_slots
  FOR EACH ROW
  EXECUTE FUNCTION public.caregiver_availability_slots_sync_agency_from_member();

DROP POLICY IF EXISTS "caregiver_availability_slots_insert_own" ON public.caregiver_availability_slots;
CREATE POLICY "caregiver_availability_slots_insert_own"
  ON public.caregiver_availability_slots
  FOR INSERT
  TO authenticated
  WITH CHECK (
    caregiver_member_id IN (
      SELECT cm.id FROM public.caregiver_members cm WHERE cm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "caregiver_availability_slots_update_own" ON public.caregiver_availability_slots;
CREATE POLICY "caregiver_availability_slots_update_own"
  ON public.caregiver_availability_slots
  FOR UPDATE
  TO authenticated
  USING (
    caregiver_member_id IN (
      SELECT cm.id FROM public.caregiver_members cm WHERE cm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    caregiver_member_id IN (
      SELECT cm.id FROM public.caregiver_members cm WHERE cm.user_id = auth.uid()
    )
  );
