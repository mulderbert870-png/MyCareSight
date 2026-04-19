-- Allow care coordinators (hs_can_manage_agency) to insert/update pay rates, same as other agency-managed billing data.

DROP POLICY IF EXISTS "pay_rate_schedule_insert" ON public.pay_rate_schedule;
CREATE POLICY "pay_rate_schedule_insert"
ON public.pay_rate_schedule FOR INSERT
TO authenticated
WITH CHECK (public.hs_can_manage_agency(agency_id));

DROP POLICY IF EXISTS "pay_rate_schedule_update" ON public.pay_rate_schedule;
CREATE POLICY "pay_rate_schedule_update"
ON public.pay_rate_schedule FOR UPDATE
TO authenticated
USING (public.hs_can_manage_agency(agency_id))
WITH CHECK (public.hs_can_manage_agency(agency_id));

COMMENT ON POLICY "pay_rate_schedule_insert" ON public.pay_rate_schedule IS
  'Agency admins and care coordinators can add pay rate rows.';
COMMENT ON POLICY "pay_rate_schedule_update" ON public.pay_rate_schedule IS
  'Agency admins and care coordinators can update pay rate rows.';
