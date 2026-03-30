-- Fix helper functions after legacy public.clients table removal.
-- Symptom: selecting from patients fails with "relation public.clients does not exist"
-- because older can_access_agency() definitions still reference public.clients.

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
      AND public.can_access_agency(p.agency_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_access_agency(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_patient(UUID) TO authenticated;

-- Also patch hs_* helpers because many policies use hs_can_access_agency(...)
-- and older definitions of hs_is_agency_admin(...) referenced public.clients.
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
