-- Caregivers could not INSERT into schedule_assignment_requests: WITH CHECK subqueries read
-- caregiver_members and patients. After 039, can_access_agency() excludes caregivers, so the
-- existing "Agency admins can view staff by agency" SELECT on caregiver_members hid the
-- caregiver's own row from themselves → EXISTS (...) was always false → RLS violation.
--
-- 1) Allow each caregiver to SELECT their own caregiver_members row (for policy checks + app).
-- 2) Replace INSERT policy: use scheduled_visits.agency_id + caregiver_members.agency_id match
--    (no JOIN to patients, so patient SELECT RLS is not required for the check).
-- 3) Refresh SELECT policy OR-branch to reference caregiver_members explicitly (post-rename clarity).

-- -------------------------------------------------------------------
-- 1) Self-read on caregiver_members
-- -------------------------------------------------------------------
DROP POLICY IF EXISTS "Caregiver members can select own row" ON public.caregiver_members;
CREATE POLICY "Caregiver members can select own row"
  ON public.caregiver_members
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- -------------------------------------------------------------------
-- 2) INSERT: pending request, open visit, same agency as logged-in caregiver row
-- -------------------------------------------------------------------
DROP POLICY IF EXISTS "schedule_assignment_requests_insert_own_pending" ON public.schedule_assignment_requests;
CREATE POLICY "schedule_assignment_requests_insert_own_pending"
  ON public.schedule_assignment_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    status = 'pending'
    AND EXISTS (
      SELECT 1
      FROM public.scheduled_visits sv
      INNER JOIN public.caregiver_members cm
        ON cm.id = caregiver_member_id
       AND cm.user_id = auth.uid()
       AND cm.agency_id IS NOT NULL
       AND cm.agency_id = sv.agency_id
      WHERE sv.id = schedule_id
        AND sv.caregiver_member_id IS NULL
        AND sv.agency_id IS NOT NULL
    )
  );

-- -------------------------------------------------------------------
-- 3) SELECT: coordinator via patient; requester via own caregiver_member_id
-- -------------------------------------------------------------------
DROP POLICY IF EXISTS "schedule_assignment_requests_select_accessible" ON public.schedule_assignment_requests;
CREATE POLICY "schedule_assignment_requests_select_accessible"
  ON public.schedule_assignment_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.scheduled_visits sv
      WHERE sv.id = schedule_id
        AND public.can_access_patient(sv.patient_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.caregiver_members cm
      WHERE cm.id = caregiver_member_id
        AND cm.user_id = auth.uid()
    )
  );
