-- Coordinators use hs_can_manage_agency (not only hs_is_agency_admin). Voiding Time & Billing
-- removes the frozen visit_financials row; DELETE was blocked for non-admin roles.

drop policy if exists "visit_financials_delete" on public.visit_financials;

create policy "visit_financials_delete"
on public.visit_financials for delete
to authenticated
using (public.hs_can_manage_agency(agency_id));
