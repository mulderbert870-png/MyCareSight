-- Allow caregivers (staff_members.user_id = auth.uid()) to manage their own staff_licenses rows.
-- SELECT already exists as "Staff members can view own licenses"; add INSERT/UPDATE/DELETE.

ALTER TABLE public.staff_licenses
  ADD COLUMN IF NOT EXISTS document_url TEXT;

DROP POLICY IF EXISTS "Staff members can insert own licenses" ON public.staff_licenses;
CREATE POLICY "Staff members can insert own licenses"
  ON public.staff_licenses FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff_members sm
      WHERE sm.id = staff_licenses.staff_member_id
        AND sm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Staff members can update own licenses" ON public.staff_licenses;
CREATE POLICY "Staff members can update own licenses"
  ON public.staff_licenses FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.staff_members sm
      WHERE sm.id = staff_licenses.staff_member_id
        AND sm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff_members sm
      WHERE sm.id = staff_licenses.staff_member_id
        AND sm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Staff members can delete own licenses" ON public.staff_licenses;
CREATE POLICY "Staff members can delete own licenses"
  ON public.staff_licenses FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.staff_members sm
      WHERE sm.id = staff_licenses.staff_member_id
        AND sm.user_id = auth.uid()
    )
  );
