-- Allow agency managers (admin/care coordinator) to read caregiver availability slots
-- for caregivers in their agency, used by Client Detail -> Add/Edit Visit caregiver picker.

DROP POLICY IF EXISTS "caregiver_availability_slots_select_manage_agency" ON public.caregiver_availability_slots;
CREATE POLICY "caregiver_availability_slots_select_manage_agency"
  ON public.caregiver_availability_slots
  FOR SELECT
  TO authenticated
  USING (
    agency_id IS NOT NULL
    AND public.hs_can_manage_agency(agency_id)
  );
