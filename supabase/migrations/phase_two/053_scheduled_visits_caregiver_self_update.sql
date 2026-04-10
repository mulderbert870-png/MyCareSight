-- Restore caregiver updates on scheduled_visits (self-unassign, etc.).
-- Migration 044 limited UPDATE to hs_can_manage_agency only, which blocked caregivers.
-- Result: UPDATE returned 0 rows and PostgREST .single() failed with
-- "Cannot coerce the result to a single JSON object".
--
-- WITH CHECK allows caregiver_member_id IS NULL so self-unassign clears assignment.

DROP POLICY IF EXISTS "scheduled_visits_update" ON public.scheduled_visits;
CREATE POLICY "scheduled_visits_update"
  ON public.scheduled_visits FOR UPDATE
  TO authenticated
  USING (
    public.hs_can_manage_agency(agency_id)
    OR (
      public.hs_is_caregiver_member(agency_id)
      AND caregiver_member_id IN (
        SELECT cm.id FROM public.caregiver_members cm WHERE cm.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.hs_can_manage_agency(agency_id)
    OR (
      public.hs_is_caregiver_member(agency_id)
      AND (
        caregiver_member_id IS NULL
        OR caregiver_member_id IN (
          SELECT cm.id FROM public.caregiver_members cm WHERE cm.user_id = auth.uid()
        )
      )
    )
  );
