-- Ensure care coordinators can read/update/delete scheduled_visits.
-- This merges policy fixes into one migration file:
-- 1) SELECT: use hs_can_access_agency (admin/coordinator/caregiver access).
-- 2) UPDATE: use hs_can_manage_agency (admin/coordinator can manage).
-- 3) DELETE: use hs_can_manage_agency (admin/coordinator can replace/delete visits).

DROP POLICY IF EXISTS "scheduled_visits_select" ON public.scheduled_visits;
CREATE POLICY "scheduled_visits_select"
  ON public.scheduled_visits FOR SELECT
  TO authenticated
  USING (public.hs_can_access_agency(agency_id));

DROP POLICY IF EXISTS "scheduled_visits_update" ON public.scheduled_visits;
CREATE POLICY "scheduled_visits_update"
  ON public.scheduled_visits FOR UPDATE
  TO authenticated
  USING (public.hs_can_manage_agency(agency_id))
  WITH CHECK (public.hs_can_manage_agency(agency_id));

DROP POLICY IF EXISTS "scheduled_visits_delete" ON public.scheduled_visits;
CREATE POLICY "scheduled_visits_delete"
  ON public.scheduled_visits FOR DELETE
  TO authenticated
  USING (public.hs_can_manage_agency(agency_id));
