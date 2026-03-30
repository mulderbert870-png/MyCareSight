-- Rename staff_* tables to caregiver_* and staff_member_id columns to caregiver_member_id.
-- Run after 035 (or any env where staff_members / staff_credentials / staff_roles exist).
-- Idempotent-friendly: uses information_schema / to_regclass / exception where needed.
--
-- After this migration, update any custom database functions or triggers (e.g. handle_new_user)
-- that still reference public.staff_members, staff_credentials, or staff_roles in their source text.

-- -------------------------------------------------------------------
-- 1) Rename FK columns staff_member_id -> caregiver_member_id (idempotent)
-- -------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff_credentials' AND column_name = 'staff_member_id'
  ) THEN
    ALTER TABLE public.staff_credentials RENAME COLUMN staff_member_id TO caregiver_member_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'caregiver_credentials' AND column_name = 'staff_member_id'
  ) THEN
    ALTER TABLE public.caregiver_credentials RENAME COLUMN staff_member_id TO caregiver_member_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'scheduled_visits' AND column_name = 'staff_member_id'
  ) THEN
    ALTER TABLE public.scheduled_visits RENAME COLUMN staff_member_id TO caregiver_member_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'schedule_assignment_requests' AND column_name = 'staff_member_id'
  ) THEN
    ALTER TABLE public.schedule_assignment_requests RENAME COLUMN staff_member_id TO caregiver_member_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'applications' AND column_name = 'staff_member_id'
  ) THEN
    ALTER TABLE public.applications RENAME COLUMN staff_member_id TO caregiver_member_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'visit_time_entries' AND column_name = 'staff_member_id'
  ) THEN
    ALTER TABLE public.visit_time_entries RENAME COLUMN staff_member_id TO caregiver_member_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'visit_approvals' AND column_name = 'staff_member_id'
  ) THEN
    ALTER TABLE public.visit_approvals RENAME COLUMN staff_member_id TO caregiver_member_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pay_rate_schedule' AND column_name = 'staff_member_id'
  ) THEN
    ALTER TABLE public.pay_rate_schedule RENAME COLUMN staff_member_id TO caregiver_member_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'visit_financials' AND column_name = 'staff_member_id'
  ) THEN
    ALTER TABLE public.visit_financials RENAME COLUMN staff_member_id TO caregiver_member_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'visit_series' AND column_name = 'primary_staff_member_id'
  ) THEN
    ALTER TABLE public.visit_series RENAME COLUMN primary_staff_member_id TO primary_caregiver_member_id;
  END IF;
END $$;

-- -------------------------------------------------------------------
-- 2) Rename tables
-- -------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.staff_members') IS NOT NULL THEN
    ALTER TABLE public.staff_members RENAME TO caregiver_members;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.staff_roles') IS NOT NULL THEN
    ALTER TABLE public.staff_roles RENAME TO caregiver_roles;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.staff_credentials') IS NOT NULL THEN
    ALTER TABLE public.staff_credentials RENAME TO caregiver_credentials;
  END IF;
END $$;

-- -------------------------------------------------------------------
-- 3) Indexes (best-effort rename; ignore if already renamed)
-- -------------------------------------------------------------------
DO $$ BEGIN
  ALTER INDEX public.idx_staff_members_agency_id RENAME TO idx_caregiver_members_agency_id;
EXCEPTION WHEN undefined_object THEN NULL;
  WHEN SQLSTATE '42710' THEN NULL;
END $$;

DO $$ BEGIN
  ALTER INDEX public.idx_staff_credentials_agency_id RENAME TO idx_caregiver_credentials_agency_id;
EXCEPTION WHEN undefined_object THEN NULL;
  WHEN SQLSTATE '42710' THEN NULL;
END $$;

DO $$ BEGIN
  ALTER INDEX public.idx_staff_credentials_staff_member_id RENAME TO idx_caregiver_credentials_caregiver_member_id;
EXCEPTION WHEN undefined_object THEN NULL;
  WHEN SQLSTATE '42710' THEN NULL;
END $$;

DO $$ BEGIN
  ALTER INDEX public.idx_staff_credentials_user_id RENAME TO idx_caregiver_credentials_user_id;
EXCEPTION WHEN undefined_object THEN NULL;
  WHEN SQLSTATE '42710' THEN NULL;
END $$;

DO $$ BEGIN
  ALTER INDEX public.idx_scheduled_visits_staff_member_id RENAME TO idx_scheduled_visits_caregiver_member_id;
EXCEPTION WHEN undefined_object THEN NULL;
  WHEN SQLSTATE '42710' THEN NULL;
END $$;

DO $$ BEGIN
  ALTER INDEX public.idx_schedule_assignment_requests_staff_member_id RENAME TO idx_schedule_assignment_requests_caregiver_member_id;
EXCEPTION WHEN undefined_object THEN NULL;
  WHEN SQLSTATE '42710' THEN NULL;
END $$;

-- -------------------------------------------------------------------
-- 4) Trigger on caregiver_credentials
-- -------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_staff_credentials_updated_at ON public.caregiver_credentials;
DROP TRIGGER IF EXISTS trg_caregiver_credentials_updated_at ON public.caregiver_credentials;
CREATE TRIGGER trg_caregiver_credentials_updated_at
  BEFORE UPDATE ON public.caregiver_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------------
-- 5) Helper: hs_is_caregiver_member (replaces hs_is_staff_member)
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hs_is_caregiver_member(p_agency_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.caregiver_members cm
    WHERE cm.agency_id = p_agency_id
      AND cm.user_id = auth.uid()
      AND COALESCE(cm.status, 'active') IN ('active', 'invited')
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

GRANT EXECUTE ON FUNCTION public.hs_is_caregiver_member(uuid) TO authenticated;

-- -------------------------------------------------------------------
-- 6) Policies that referenced hs_is_staff_member + staff_member column
-- -------------------------------------------------------------------
DROP POLICY IF EXISTS "scheduled_visits_update" ON public.scheduled_visits;
CREATE POLICY "scheduled_visits_update"
  ON public.scheduled_visits FOR UPDATE
  TO authenticated
  USING (
    public.hs_can_manage_agency(agency_id)
    OR (
      public.hs_is_caregiver_member(agency_id)
      AND caregiver_member_id IN (
        SELECT cm.id FROM public.caregiver_members cm WHERE cm.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.hs_can_manage_agency(agency_id)
    OR (
      public.hs_is_caregiver_member(agency_id)
      AND caregiver_member_id IN (
        SELECT cm.id FROM public.caregiver_members cm WHERE cm.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "visit_time_entries_insert" ON public.visit_time_entries;
CREATE POLICY "visit_time_entries_insert"
  ON public.visit_time_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    public.hs_can_manage_agency(agency_id)
    OR (
      public.hs_is_caregiver_member(agency_id)
      AND caregiver_member_id IN (
        SELECT cm.id FROM public.caregiver_members cm WHERE cm.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "visit_time_entries_update" ON public.visit_time_entries;
CREATE POLICY "visit_time_entries_update"
  ON public.visit_time_entries FOR UPDATE
  TO authenticated
  USING (
    public.hs_can_manage_agency(agency_id)
    OR (
      public.hs_is_caregiver_member(agency_id)
      AND caregiver_member_id IN (
        SELECT cm.id FROM public.caregiver_members cm WHERE cm.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.hs_can_manage_agency(agency_id)
    OR (
      public.hs_is_caregiver_member(agency_id)
      AND caregiver_member_id IN (
        SELECT cm.id FROM public.caregiver_members cm WHERE cm.user_id = auth.uid()
      )
    )
  );

-- -------------------------------------------------------------------
-- 7) RPC: assignment approval uses caregiver_member_id
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_schedule_assignment_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule_id uuid;
  v_caregiver_id uuid;
  v_status text;
  v_patient_id uuid;
  v_updated int;
BEGIN
  SELECT sar.schedule_id, sar.caregiver_member_id, sar.status
  INTO v_schedule_id, v_caregiver_id, v_status
  FROM public.schedule_assignment_requests sar
  WHERE sar.id = p_request_id
  FOR UPDATE;

  IF v_schedule_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_pending');
  END IF;

  SELECT sv.patient_id INTO v_patient_id
  FROM public.scheduled_visits sv
  WHERE sv.id = v_schedule_id;

  IF v_patient_id IS NULL OR NOT public.can_access_patient(v_patient_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  UPDATE public.scheduled_visits
  SET caregiver_member_id = v_caregiver_id,
      updated_at = now()
  WHERE id = v_schedule_id
    AND caregiver_member_id IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'schedule_already_assigned');
  END IF;

  UPDATE public.schedule_assignment_requests
  SET status = 'approved',
      resolved_at = now(),
      resolved_by = auth.uid(),
      updated_at = now()
  WHERE id = p_request_id;

  UPDATE public.schedule_assignment_requests
  SET status = 'declined',
      decline_reason = 'Another caregiver was assigned to this visit.',
      resolved_at = now(),
      resolved_by = auth.uid(),
      updated_at = now()
  WHERE schedule_id = v_schedule_id
    AND status = 'pending'
    AND id <> p_request_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON TABLE public.schedule_assignment_requests IS
  'Caregiver requests to be assigned to a visit; coordinator approves (sets scheduled_visits.caregiver_member_id) or declines.';

-- -------------------------------------------------------------------
-- 8) Drop legacy helper name
-- -------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.hs_is_staff_member(uuid);

-- -------------------------------------------------------------------
-- 9) caregiver_credentials self-service policies (033): refresh table refs
-- -------------------------------------------------------------------
DROP POLICY IF EXISTS "staff_credentials_insert_own_staff" ON public.caregiver_credentials;
CREATE POLICY "caregiver_credentials_insert_own_staff"
  ON public.caregiver_credentials FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.caregiver_members cm
      WHERE cm.id = caregiver_credentials.caregiver_member_id
        AND cm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "staff_credentials_update_own_staff" ON public.caregiver_credentials;
CREATE POLICY "caregiver_credentials_update_own_staff"
  ON public.caregiver_credentials FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.caregiver_members cm
      WHERE cm.id = caregiver_credentials.caregiver_member_id
        AND cm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.caregiver_members cm
      WHERE cm.id = caregiver_credentials.caregiver_member_id
        AND cm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "staff_credentials_delete_own_staff" ON public.caregiver_credentials;
CREATE POLICY "caregiver_credentials_delete_own_staff"
  ON public.caregiver_credentials FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.caregiver_members cm
      WHERE cm.id = caregiver_credentials.caregiver_member_id
        AND cm.user_id = auth.uid()
    )
  );

-- Rename generic policies on caregiver_credentials for clarity (drop old names, recreate)
DROP POLICY IF EXISTS "staff_credentials_select" ON public.caregiver_credentials;
CREATE POLICY "caregiver_credentials_select"
  ON public.caregiver_credentials FOR SELECT
  TO authenticated
  USING (public.hs_can_access_agency(agency_id));

DROP POLICY IF EXISTS "staff_credentials_insert" ON public.caregiver_credentials;
CREATE POLICY "caregiver_credentials_insert"
  ON public.caregiver_credentials FOR INSERT
  TO authenticated
  WITH CHECK (public.hs_can_manage_agency(agency_id));

DROP POLICY IF EXISTS "staff_credentials_update" ON public.caregiver_credentials;
CREATE POLICY "caregiver_credentials_update"
  ON public.caregiver_credentials FOR UPDATE
  TO authenticated
  USING (public.hs_can_manage_agency(agency_id))
  WITH CHECK (public.hs_can_manage_agency(agency_id));

DROP POLICY IF EXISTS "staff_credentials_delete" ON public.caregiver_credentials;
CREATE POLICY "caregiver_credentials_delete"
  ON public.caregiver_credentials FOR DELETE
  TO authenticated
  USING (public.hs_is_agency_admin(agency_id));

-- -------------------------------------------------------------------
-- 10) caregiver_members: company-owner update policy (034)
-- -------------------------------------------------------------------
DROP POLICY IF EXISTS "Company owners can update own staff" ON public.caregiver_members;
CREATE POLICY "Company owners can update own staff"
  ON public.caregiver_members FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.agency_admins aa
      WHERE aa.id = caregiver_members.company_owner_id
        AND aa.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.agency_admins aa
      WHERE aa.id = caregiver_members.company_owner_id
        AND aa.user_id = auth.uid()
    )
  );
