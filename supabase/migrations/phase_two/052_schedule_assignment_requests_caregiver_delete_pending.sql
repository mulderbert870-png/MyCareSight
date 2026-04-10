-- Allow caregivers to withdraw their own pending assignment request (Cancel Request in UI).

GRANT DELETE ON public.schedule_assignment_requests TO authenticated;

DROP POLICY IF EXISTS "Caregiver can delete own pending assignment request" ON public.schedule_assignment_requests;
CREATE POLICY "Caregiver can delete own pending assignment request"
  ON public.schedule_assignment_requests
  FOR DELETE
  TO authenticated
  USING (
    status = 'pending'
    AND EXISTS (
      SELECT 1
      FROM public.caregiver_members cm
      WHERE cm.id = caregiver_member_id
        AND cm.user_id = auth.uid()
    )
  );
