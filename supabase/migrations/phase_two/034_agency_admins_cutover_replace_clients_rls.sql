-- Replace clients-based access with agency_admins; backfill every clients row; relax agency_id on
-- agency_admins for pre-agency onboarding; fix hs_is_agency_admin + can_access_agency.

-- -------------------------------------------------------------------
-- 1) agency_admins.agency_id nullable (matches legacy clients without agency)
-- -------------------------------------------------------------------
ALTER TABLE public.agency_admins
  ALTER COLUMN agency_id DROP NOT NULL;

-- -------------------------------------------------------------------
-- 2) Backfill all clients → agency_admins (preserve id)
-- -------------------------------------------------------------------
INSERT INTO public.agency_admins (
  id,
  user_id,
  agency_id,
  expert_id,
  company_owner_id,
  company_name,
  contact_name,
  contact_email,
  contact_phone,
  status,
  start_date,
  business_type,
  tax_id,
  primary_license_number,
  website,
  physical_street_address,
  physical_city,
  physical_state,
  physical_zip_code,
  mailing_street_address,
  mailing_city,
  mailing_state,
  mailing_zip_code,
  created_at,
  updated_at
)
SELECT
  c.id,
  c.company_owner_id,
  c.agency_id,
  le.id,
  c.company_owner_id,
  c.company_name,
  c.contact_name,
  c.contact_email,
  c.contact_phone,
  c.status,
  c.start_date,
  COALESCE(c.business_type, a.business_type),
  COALESCE(c.tax_id, a.tax_id),
  COALESCE(c.primary_license_number, a.primary_license_number),
  COALESCE(c.website, a.website),
  COALESCE(c.physical_street_address, a.physical_street_address),
  COALESCE(c.physical_city, a.physical_city),
  COALESCE(c.physical_state, a.physical_state),
  COALESCE(c.physical_zip_code, a.physical_zip_code),
  COALESCE(c.mailing_street_address, a.mailing_street_address),
  COALESCE(c.mailing_city, a.mailing_city),
  COALESCE(c.mailing_state, a.mailing_state),
  COALESCE(c.mailing_zip_code, a.mailing_zip_code),
  c.created_at,
  c.updated_at
FROM public.clients c
LEFT JOIN public.agencies a ON a.id = c.agency_id
LEFT JOIN public.licensing_experts le ON le.user_id = c.expert_id
WHERE NOT EXISTS (SELECT 1 FROM public.agency_admins aa WHERE aa.id = c.id)
ON CONFLICT (id) DO NOTHING;

-- -------------------------------------------------------------------
-- 3) can_access_agency: agency_admins instead of clients
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
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_access_agency(UUID) TO authenticated;

-- -------------------------------------------------------------------
-- 4) hs_is_agency_admin: drop legacy clients branch
-- -------------------------------------------------------------------
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

-- -------------------------------------------------------------------
-- 5) agency_admins RLS: allow self-insert / self-update when agency not yet assigned
-- -------------------------------------------------------------------
DROP POLICY IF EXISTS "agency_admins_insert" ON public.agency_admins;
CREATE POLICY "agency_admins_insert"
  ON public.agency_admins FOR INSERT
  TO authenticated
  WITH CHECK (
    (user_id = auth.uid() AND agency_id IS NULL)
    OR public.hs_is_agency_admin(agency_id)
  );

DROP POLICY IF EXISTS "agency_admins_update" ON public.agency_admins;
CREATE POLICY "agency_admins_update"
  ON public.agency_admins FOR UPDATE
  TO authenticated
  USING (
    (user_id = auth.uid())
    OR public.hs_is_agency_admin(agency_id)
  )
  WITH CHECK (
    (user_id = auth.uid())
    OR public.hs_is_agency_admin(agency_id)
  );

DROP POLICY IF EXISTS "agency_admins_delete" ON public.agency_admins;
CREATE POLICY "agency_admins_delete"
  ON public.agency_admins FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.hs_is_agency_admin(agency_id)
  );

-- -------------------------------------------------------------------
-- 6) agencies policies: company owner via agency_admins
-- -------------------------------------------------------------------
DROP POLICY IF EXISTS "Company owners can view own agency" ON public.agencies;
DROP POLICY IF EXISTS "Company owners can insert own agency" ON public.agencies;
DROP POLICY IF EXISTS "Company owners can update own agency" ON public.agencies;
DROP POLICY IF EXISTS "Admins can insert agency company details" ON public.agencies;
DROP POLICY IF EXISTS "Admins can update agency company details" ON public.agencies;
DROP POLICY IF EXISTS "Admins can delete agency company details" ON public.agencies;
DROP POLICY IF EXISTS "Admins can view agency company details" ON public.agencies;

CREATE POLICY "Company owners can view own agency"
  ON public.agencies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.agency_admins aa
      WHERE aa.user_id = auth.uid()
        AND aa.id = ANY (agencies.agency_admin_ids)
    )
  );

CREATE POLICY "Company owners can insert own agency"
  ON public.agencies FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agency_admins aa
      WHERE aa.user_id = auth.uid()
        AND aa.id = ANY (agencies.agency_admin_ids)
    )
  );

CREATE POLICY "Company owners can update own agency"
  ON public.agencies FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.agency_admins aa
      WHERE aa.user_id = auth.uid()
        AND aa.id = ANY (agencies.agency_admin_ids)
    )
  );

CREATE POLICY "Admins can insert agency company details"
  ON public.agencies FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM public.agency_admins aa
      WHERE aa.user_id = auth.uid()
        AND aa.id = ANY (agencies.agency_admin_ids)
    )
  );

CREATE POLICY "Admins can update agency company details"
  ON public.agencies FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM public.agency_admins aa
      WHERE aa.user_id = auth.uid()
        AND aa.id = ANY (agencies.agency_admin_ids)
    )
  );

CREATE POLICY "Admins can delete agency company details"
  ON public.agencies FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM public.agency_admins aa
      WHERE aa.user_id = auth.uid()
        AND aa.id = ANY (agencies.agency_admin_ids)
    )
  );

CREATE POLICY "Admins can view agency company details"
  ON public.agencies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM public.agency_admins aa
      WHERE aa.user_id = auth.uid()
        AND aa.id = ANY (agencies.agency_admin_ids)
    )
  );

-- -------------------------------------------------------------------
-- 7) staff_members update policy (company owner via agency_admins)
-- -------------------------------------------------------------------
DROP POLICY IF EXISTS "Company owners can update own staff" ON public.staff_members;
CREATE POLICY "Company owners can update own staff"
  ON public.staff_members FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.agency_admins aa
      WHERE aa.id = staff_members.company_owner_id
        AND aa.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agency_admins aa
      WHERE aa.id = staff_members.company_owner_id
        AND aa.user_id = auth.uid()
    )
  );

-- -------------------------------------------------------------------
-- 8) applications policies (client owner → agency_admin)
-- -------------------------------------------------------------------
DROP POLICY IF EXISTS "Client owners can view staff license applications" ON public.applications;
CREATE POLICY "Client owners can view staff license applications"
  ON public.applications FOR SELECT
  USING (
    staff_member_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.staff_members sm
      INNER JOIN public.agency_admins aa ON aa.id = sm.company_owner_id
      WHERE sm.id = applications.staff_member_id
        AND aa.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Client owners can insert staff license applications" ON public.applications;
CREATE POLICY "Client owners can insert staff license applications"
  ON public.applications FOR INSERT
  WITH CHECK (
    staff_member_id IS NOT NULL
    AND company_owner_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.staff_members sm
      INNER JOIN public.agency_admins aa ON aa.id = sm.company_owner_id
      WHERE sm.id = applications.staff_member_id
        AND aa.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Client owners can update staff license applications" ON public.applications;
CREATE POLICY "Client owners can update staff license applications"
  ON public.applications FOR UPDATE
  USING (
    staff_member_id IS NOT NULL
    AND company_owner_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.staff_members sm
      INNER JOIN public.agency_admins aa ON aa.id = sm.company_owner_id
      WHERE sm.id = applications.staff_member_id
        AND aa.user_id = auth.uid()
    )
  )
  WITH CHECK (
    staff_member_id IS NOT NULL
    AND company_owner_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.staff_members sm
      INNER JOIN public.agency_admins aa ON aa.id = sm.company_owner_id
      WHERE sm.id = applications.staff_member_id
        AND aa.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Client owners can delete staff license applications" ON public.applications;
CREATE POLICY "Client owners can delete staff license applications"
  ON public.applications FOR DELETE
  USING (
    staff_member_id IS NOT NULL
    AND company_owner_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.staff_members sm
      INNER JOIN public.agency_admins aa ON aa.id = sm.company_owner_id
      WHERE sm.id = applications.staff_member_id
        AND aa.user_id = auth.uid()
    )
  );

-- -------------------------------------------------------------------
-- 9) Remove coordinator policy on clients (table dropped next migration batch)
-- -------------------------------------------------------------------
DROP POLICY IF EXISTS "Care coordinators can view clients by agency" ON public.clients;
