-- Align staff_licenses RLS with staff_members (021 + 024).
-- staff_members allows SELECT when public.can_access_agency(agency_id) is true
-- (company owner of a client in that agency, or care coordinator for that agency).
-- staff_licenses previously only allowed rows where the staff member's employer client
-- had company_owner_id = auth.uid(), so coordinators and other agency-scoped users
-- saw staff in the UI but empty certification lists.

DROP POLICY IF EXISTS "Agency scoped users can view staff licenses by agency" ON public.staff_licenses;
CREATE POLICY "Agency scoped users can view staff licenses by agency"
  ON public.staff_licenses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.staff_members sm
      WHERE sm.id = staff_licenses.staff_member_id
        AND public.can_access_agency(sm.agency_id)
    )
  );

DROP POLICY IF EXISTS "Agency scoped users can insert staff licenses by agency" ON public.staff_licenses;
CREATE POLICY "Agency scoped users can insert staff licenses by agency"
  ON public.staff_licenses FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff_members sm
      WHERE sm.id = staff_licenses.staff_member_id
        AND public.can_access_agency(sm.agency_id)
    )
  );

DROP POLICY IF EXISTS "Agency scoped users can update staff licenses by agency" ON public.staff_licenses;
CREATE POLICY "Agency scoped users can update staff licenses by agency"
  ON public.staff_licenses FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.staff_members sm
      WHERE sm.id = staff_licenses.staff_member_id
        AND public.can_access_agency(sm.agency_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff_members sm
      WHERE sm.id = staff_licenses.staff_member_id
        AND public.can_access_agency(sm.agency_id)
    )
  );

DROP POLICY IF EXISTS "Agency scoped users can delete staff licenses by agency" ON public.staff_licenses;
CREATE POLICY "Agency scoped users can delete staff licenses by agency"
  ON public.staff_licenses FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.staff_members sm
      WHERE sm.id = staff_licenses.staff_member_id
        AND public.can_access_agency(sm.agency_id)
    )
  );
