-- PostgreSQL 15+ can require an explicit WITH CHECK on UPDATE. Without it, some setups
-- reject JSONB updates or behave inconsistently. Mirror USING into WITH CHECK.

DROP POLICY IF EXISTS "Company owners can update own staff" ON public.staff_members;
CREATE POLICY "Company owners can update own staff"
  ON public.staff_members
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = staff_members.company_owner_id
        AND c.company_owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = staff_members.company_owner_id
        AND c.company_owner_id = auth.uid()
    )
  );
