-- phast_two: add care coordinator role support and agency mapping.

-- 1) Add a dedicated care_coordinators table (similar to clients/staff role tables).
CREATE TABLE IF NOT EXISTS public.care_coordinators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_care_coordinators_user_id ON public.care_coordinators(user_id);
CREATE INDEX IF NOT EXISTS idx_care_coordinators_agency_id ON public.care_coordinators(agency_id);

-- 2) Extend agency access helper to include care coordinators assigned to the agency.
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

-- 3) Enable and add basic RLS for care coordinators table itself.
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

