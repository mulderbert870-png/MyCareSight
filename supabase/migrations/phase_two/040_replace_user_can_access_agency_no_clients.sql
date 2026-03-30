-- Legacy helper public.user_can_access_agency(agency_uuid uuid) still referenced
-- public.clients (dropped). Redefine using agency_admins + care_coordinators
-- (same semantics as public.can_access_agency in 037/039).

CREATE OR REPLACE FUNCTION public.user_can_access_agency(agency_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    agency_uuid IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.agency_admins aa
        WHERE aa.user_id = auth.uid()
          AND aa.agency_id = agency_uuid
          AND COALESCE(aa.status, 'active') IN ('active', 'invited', 'pending')
      )
      OR EXISTS (
        SELECT 1
        FROM public.care_coordinators cc
        WHERE cc.user_id = auth.uid()
          AND cc.agency_id = agency_uuid
          AND COALESCE(cc.status, 'active') IN ('active', 'invited', 'pending')
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.user_can_access_agency(uuid) TO authenticated;
