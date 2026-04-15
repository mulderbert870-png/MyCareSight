-- Allow each caregiver to update their own caregiver_members row (e.g. skills array)
-- from the My Skills & Certifications page. Agency-admin "company owner" policy remains;
-- permissive policies are OR-combined.

CREATE POLICY "Caregiver members can update own row"
  ON public.caregiver_members
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON POLICY "Caregiver members can update own row" ON public.caregiver_members IS
  'Self-service profile fields such as skills from the caregiver portal.';
