-- Align DELETE with INSERT/UPDATE on patient_care_plan_tasks.
-- Previously only hs_is_agency_admin could DELETE; coordinators/managers could
-- INSERT/UPDATE (hs_can_manage_agency) so Save removed tasks in UI but DB kept
-- all rows (Postgres RLS: 0 rows deleted, no error).

DROP POLICY IF EXISTS "patient_care_plan_tasks_delete" ON public.patient_care_plan_tasks;

CREATE POLICY "patient_care_plan_tasks_delete"
ON public.patient_care_plan_tasks FOR DELETE
TO authenticated
USING (public.hs_can_manage_agency(agency_id));
