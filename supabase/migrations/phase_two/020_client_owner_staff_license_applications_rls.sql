-- Allow client company owners (via clients.company_owner_id) to view and manage
-- caregiver license rows in applications (staff_member_id set, company_owner_id null).

DROP POLICY IF EXISTS "Client owners can view staff license applications" ON public.applications;
CREATE POLICY "Client owners can view staff license applications"
  ON public.applications
  FOR SELECT
  USING (
    staff_member_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.staff_members sm
      INNER JOIN public.clients c ON c.id = sm.company_owner_id
      WHERE sm.id = applications.staff_member_id
        AND c.company_owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Client owners can insert staff license applications" ON public.applications;
CREATE POLICY "Client owners can insert staff license applications"
  ON public.applications
  FOR INSERT
  WITH CHECK (
    staff_member_id IS NOT NULL
    AND company_owner_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.staff_members sm
      INNER JOIN public.clients c ON c.id = sm.company_owner_id
      WHERE sm.id = applications.staff_member_id
        AND c.company_owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Client owners can update staff license applications" ON public.applications;
CREATE POLICY "Client owners can update staff license applications"
  ON public.applications
  FOR UPDATE
  USING (
    staff_member_id IS NOT NULL
    AND company_owner_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.staff_members sm
      INNER JOIN public.clients c ON c.id = sm.company_owner_id
      WHERE sm.id = applications.staff_member_id
        AND c.company_owner_id = auth.uid()
    )
  )
  WITH CHECK (
    staff_member_id IS NOT NULL
    AND company_owner_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.staff_members sm
      INNER JOIN public.clients c ON c.id = sm.company_owner_id
      WHERE sm.id = applications.staff_member_id
        AND c.company_owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Client owners can delete staff license applications" ON public.applications;
CREATE POLICY "Client owners can delete staff license applications"
  ON public.applications
  FOR DELETE
  USING (
    staff_member_id IS NOT NULL
    AND company_owner_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.staff_members sm
      INNER JOIN public.clients c ON c.id = sm.company_owner_id
      WHERE sm.id = applications.staff_member_id
        AND c.company_owner_id = auth.uid()
    )
  );
