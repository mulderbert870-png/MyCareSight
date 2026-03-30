-- Patients INSERT/SELECT failed with 42P01 "relation public.clients does not exist" because
-- RLS policies called can_access_agency() while the DB still had an old definition
-- referencing public.clients (dropped in 035).
--
-- This migration:
-- 1) Replaces can_access_agency / can_access_patient / hs_* helpers (safe idempotent).
-- 2) Redefines can_access_patient WITHOUT calling can_access_agency (breaks stale chain).
-- 3) Replaces public.patients policies with inline agency_admins | care_coordinators checks
--    so PostgREST no longer evaluates legacy function bodies for these rows.

-- -------------------------------------------------------------------
-- 1) Core helpers (same semantics as 037)
-- -------------------------------------------------------------------
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
        FROM public.agency_admins aa
        WHERE aa.user_id = auth.uid()
          AND aa.agency_id = p_agency_id
          AND COALESCE(aa.status, 'active') IN ('active', 'invited', 'pending')
      )
      OR EXISTS (
        SELECT 1
        FROM public.care_coordinators cc
        WHERE cc.user_id = auth.uid()
          AND cc.agency_id = p_agency_id
          AND COALESCE(cc.status, 'active') IN ('active', 'invited', 'pending')
      )
    );
$$;

-- Inline membership: do NOT call can_access_agency (avoids any broken dependency).
CREATE OR REPLACE FUNCTION public.can_access_patient(p_patient_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.patients p
    WHERE p.id = p_patient_id
      AND p.agency_id IS NOT NULL
      AND (
        EXISTS (
          SELECT 1
          FROM public.agency_admins aa
          WHERE aa.user_id = auth.uid()
            AND aa.agency_id = p.agency_id
            AND COALESCE(aa.status, 'active') IN ('active', 'invited', 'pending')
        )
        OR EXISTS (
          SELECT 1
          FROM public.care_coordinators cc
          WHERE cc.user_id = auth.uid()
            AND cc.agency_id = p.agency_id
            AND COALESCE(cc.status, 'active') IN ('active', 'invited', 'pending')
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_access_agency(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_patient(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.hs_is_agency_admin(p_agency_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_agency_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.agency_admins aa
      WHERE aa.agency_id = p_agency_id
        AND aa.user_id = auth.uid()
        AND COALESCE(aa.status, 'active') IN ('active', 'invited', 'pending')
    );
$$;

CREATE OR REPLACE FUNCTION public.hs_can_access_agency(p_agency_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.hs_is_agency_admin(p_agency_id)
    OR public.hs_is_care_coordinator(p_agency_id)
    OR public.hs_is_caregiver_member(p_agency_id);
$$;

CREATE OR REPLACE FUNCTION public.hs_can_manage_agency(p_agency_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.hs_is_agency_admin(p_agency_id)
    OR public.hs_is_care_coordinator(p_agency_id);
$$;

GRANT EXECUTE ON FUNCTION public.hs_is_agency_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hs_can_access_agency(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hs_can_manage_agency(uuid) TO authenticated;

-- -------------------------------------------------------------------
-- 2) public.patients: drop old + unified policies (inline, no function call)
-- -------------------------------------------------------------------
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agency admins can view patients by agency" ON public.patients;
DROP POLICY IF EXISTS "Agency admins can insert patients by agency" ON public.patients;
DROP POLICY IF EXISTS "Agency admins can update patients by agency" ON public.patients;
DROP POLICY IF EXISTS "Agency admins can delete patients by agency" ON public.patients;
DROP POLICY IF EXISTS "Care coordinators can view patients by agency" ON public.patients;

CREATE POLICY "Agency members can select patients by agency"
  ON public.patients FOR SELECT
  TO authenticated
  USING (
    patients.agency_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.agency_admins aa
        WHERE aa.user_id = auth.uid()
          AND aa.agency_id = patients.agency_id
          AND COALESCE(aa.status, 'active') IN ('active', 'invited', 'pending')
      )
      OR EXISTS (
        SELECT 1
        FROM public.care_coordinators cc
        WHERE cc.user_id = auth.uid()
          AND cc.agency_id = patients.agency_id
          AND COALESCE(cc.status, 'active') IN ('active', 'invited', 'pending')
      )
    )
  );

CREATE POLICY "Agency members can insert patients by agency"
  ON public.patients FOR INSERT
  TO authenticated
  WITH CHECK (
    patients.agency_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.agency_admins aa
        WHERE aa.user_id = auth.uid()
          AND aa.agency_id = patients.agency_id
          AND COALESCE(aa.status, 'active') IN ('active', 'invited', 'pending')
      )
      OR EXISTS (
        SELECT 1
        FROM public.care_coordinators cc
        WHERE cc.user_id = auth.uid()
          AND cc.agency_id = patients.agency_id
          AND COALESCE(cc.status, 'active') IN ('active', 'invited', 'pending')
      )
    )
  );

CREATE POLICY "Agency members can update patients by agency"
  ON public.patients FOR UPDATE
  TO authenticated
  USING (
    patients.agency_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.agency_admins aa
        WHERE aa.user_id = auth.uid()
          AND aa.agency_id = patients.agency_id
          AND COALESCE(aa.status, 'active') IN ('active', 'invited', 'pending')
      )
      OR EXISTS (
        SELECT 1
        FROM public.care_coordinators cc
        WHERE cc.user_id = auth.uid()
          AND cc.agency_id = patients.agency_id
          AND COALESCE(cc.status, 'active') IN ('active', 'invited', 'pending')
      )
    )
  )
  WITH CHECK (
    patients.agency_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.agency_admins aa
        WHERE aa.user_id = auth.uid()
          AND aa.agency_id = patients.agency_id
          AND COALESCE(aa.status, 'active') IN ('active', 'invited', 'pending')
      )
      OR EXISTS (
        SELECT 1
        FROM public.care_coordinators cc
        WHERE cc.user_id = auth.uid()
          AND cc.agency_id = patients.agency_id
          AND COALESCE(cc.status, 'active') IN ('active', 'invited', 'pending')
      )
    )
  );

CREATE POLICY "Agency members can delete patients by agency"
  ON public.patients FOR DELETE
  TO authenticated
  USING (
    patients.agency_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.agency_admins aa
        WHERE aa.user_id = auth.uid()
          AND aa.agency_id = patients.agency_id
          AND COALESCE(aa.status, 'active') IN ('active', 'invited', 'pending')
      )
      OR EXISTS (
        SELECT 1
        FROM public.care_coordinators cc
        WHERE cc.user_id = auth.uid()
          AND cc.agency_id = patients.agency_id
          AND COALESCE(cc.status, 'active') IN ('active', 'invited', 'pending')
      )
    )
  );
