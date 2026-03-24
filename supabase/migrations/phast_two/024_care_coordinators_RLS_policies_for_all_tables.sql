-- phast_two: care coordinator RLS coverage across agency-scoped tables.
-- Goal: care coordinators should see/manage the same agency-scoped data as agency admins.

-- 1) Ensure helper function supports care coordinators.
CREATE OR REPLACE FUNCTION public.can_access_agency(p_agency_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_agency_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.clients c
        WHERE c.company_owner_id = auth.uid()
          AND c.agency_id = p_agency_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.care_coordinators cc
        WHERE cc.user_id = auth.uid()
          AND cc.agency_id = p_agency_id
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_access_agency(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_patient(UUID) TO authenticated;

-- 2) care_coordinators table policies
ALTER TABLE public.care_coordinators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own care coordinator row" ON public.care_coordinators;
CREATE POLICY "Users can view own care coordinator row"
  ON public.care_coordinators FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own care coordinator row" ON public.care_coordinators;
CREATE POLICY "Users can update own care coordinator row"
  ON public.care_coordinators FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all care coordinator rows" ON public.care_coordinators;
CREATE POLICY "Admins can view all care coordinator rows"
  ON public.care_coordinators FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role = 'admin'
    )
  );

-- 3) agencies table: coordinator must be able to read their own agency row.
-- Existing admin/company_owner policies remain; this adds coordinator read access.
DROP POLICY IF EXISTS "Care coordinators can view own agency" ON public.agencies;
CREATE POLICY "Care coordinators can view own agency"
  ON public.agencies FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.care_coordinators cc
      WHERE cc.user_id = auth.uid()
        AND cc.agency_id = agencies.id
    )
  );

-- 4) clients table: coordinator must read agency admin client rows in same agency.
-- Needed for app-side scope resolution (agency -> admin client -> company_owner_id).
DROP POLICY IF EXISTS "Care coordinators can view clients by agency" ON public.clients;
CREATE POLICY "Care coordinators can view clients by agency"
  ON public.clients FOR SELECT
  USING (public.can_access_agency(agency_id));

-- 5) applications table: coordinator needs same access to staff-license applications
-- visible to agency admins (rows tied to staff_members in same agency).
DROP POLICY IF EXISTS "Care coordinators can view staff license applications by agency" ON public.applications;
CREATE POLICY "Care coordinators can view staff license applications by agency"
  ON public.applications FOR SELECT
  USING (
    staff_member_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.staff_members sm
      WHERE sm.id = applications.staff_member_id
        AND public.can_access_agency(sm.agency_id)
    )
  );

DROP POLICY IF EXISTS "Care coordinators can insert staff license applications by agency" ON public.applications;
CREATE POLICY "Care coordinators can insert staff license applications by agency"
  ON public.applications FOR INSERT
  WITH CHECK (
    staff_member_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.staff_members sm
      WHERE sm.id = applications.staff_member_id
        AND public.can_access_agency(sm.agency_id)
    )
  );

DROP POLICY IF EXISTS "Care coordinators can update staff license applications by agency" ON public.applications;
CREATE POLICY "Care coordinators can update staff license applications by agency"
  ON public.applications FOR UPDATE
  USING (
    staff_member_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.staff_members sm
      WHERE sm.id = applications.staff_member_id
        AND public.can_access_agency(sm.agency_id)
    )
  )
  WITH CHECK (
    staff_member_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.staff_members sm
      WHERE sm.id = applications.staff_member_id
        AND public.can_access_agency(sm.agency_id)
    )
  );

DROP POLICY IF EXISTS "Care coordinators can delete staff license applications by agency" ON public.applications;
CREATE POLICY "Care coordinators can delete staff license applications by agency"
  ON public.applications FOR DELETE
  USING (
    staff_member_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.staff_members sm
      WHERE sm.id = applications.staff_member_id
        AND public.can_access_agency(sm.agency_id)
    )
  );

-- NOTE:
-- patients, staff_members, and patient-linked tables are already agency-scoped in 021 via
-- public.can_access_agency(...) / public.can_access_patient(...). Once this migration runs,
-- care coordinators inherit those accesses through the helper function above.
