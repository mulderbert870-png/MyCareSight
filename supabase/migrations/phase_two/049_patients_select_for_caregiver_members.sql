-- Caregivers can read scheduled_visits for their agency (hs_can_access_agency) but could not
-- SELECT patients, so caregiver-facing UIs that join visit → patient saw fallback "Client".
-- Allow caregiver_members in the same agency to read patient rows (display names for visits).

CREATE POLICY "Caregiver members can select patients in their agency"
  ON public.patients FOR SELECT
  TO authenticated
  USING (
    patients.agency_id IS NOT NULL
    AND public.hs_is_caregiver_member(patients.agency_id)
  );
