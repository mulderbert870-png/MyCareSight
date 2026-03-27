-- phast_two: agency-scoped access for patients and caregivers.
-- Adds/ensures agency_id columns, backfills from existing mappings,
-- and adds RLS policies so all agency admins in the same agency can access shared data.

-- 1) Ensure agency_id columns exist (staff_members already added in older migration; keep idempotent).
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES public.agencies(id) ON DELETE SET NULL;

ALTER TABLE public.staff_members
  ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES public.agencies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_patients_agency_id ON public.patients(agency_id);
CREATE INDEX IF NOT EXISTS idx_staff_members_agency_id ON public.staff_members(agency_id);

-- 2) Backfill staff_members.agency_id from owning client row when missing/mismatched.
UPDATE public.staff_members sm
SET agency_id = c.agency_id
FROM public.clients c
WHERE c.id = sm.company_owner_id
  AND c.agency_id IS NOT NULL
  AND (sm.agency_id IS NULL OR sm.agency_id <> c.agency_id);

-- 3) Helper functions used by policies.
CREATE OR REPLACE FUNCTION public.can_access_agency(p_agency_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_agency_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.company_owner_id = auth.uid()
        AND c.agency_id = p_agency_id
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

-- 4) Agency-scoped policies for patients.
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agency admins can view patients by agency" ON public.patients;
CREATE POLICY "Agency admins can view patients by agency"
  ON public.patients FOR SELECT
  USING (public.can_access_agency(agency_id));

DROP POLICY IF EXISTS "Agency admins can insert patients by agency" ON public.patients;
CREATE POLICY "Agency admins can insert patients by agency"
  ON public.patients FOR INSERT
  WITH CHECK (public.can_access_agency(agency_id));

DROP POLICY IF EXISTS "Agency admins can update patients by agency" ON public.patients;
CREATE POLICY "Agency admins can update patients by agency"
  ON public.patients FOR UPDATE
  USING (public.can_access_patient(id))
  WITH CHECK (public.can_access_agency(agency_id));

DROP POLICY IF EXISTS "Agency admins can delete patients by agency" ON public.patients;
CREATE POLICY "Agency admins can delete patients by agency"
  ON public.patients FOR DELETE
  USING (public.can_access_patient(id));

-- 5) Agency-scoped policies for patient-linked tables.
DROP POLICY IF EXISTS "Agency admins can view caregiver_requirements by agency" ON public.caregiver_requirements;
CREATE POLICY "Agency admins can view caregiver_requirements by agency"
  ON public.caregiver_requirements FOR SELECT
  USING (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can insert caregiver_requirements by agency" ON public.caregiver_requirements;
CREATE POLICY "Agency admins can insert caregiver_requirements by agency"
  ON public.caregiver_requirements FOR INSERT
  WITH CHECK (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can update caregiver_requirements by agency" ON public.caregiver_requirements;
CREATE POLICY "Agency admins can update caregiver_requirements by agency"
  ON public.caregiver_requirements FOR UPDATE
  USING (public.can_access_patient(patient_id))
  WITH CHECK (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can delete caregiver_requirements by agency" ON public.caregiver_requirements;
CREATE POLICY "Agency admins can delete caregiver_requirements by agency"
  ON public.caregiver_requirements FOR DELETE
  USING (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can view patients representatives by agency" ON public.patients_representatives;
CREATE POLICY "Agency admins can view patients representatives by agency"
  ON public.patients_representatives FOR SELECT
  USING (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can insert patients representatives by agency" ON public.patients_representatives;
CREATE POLICY "Agency admins can insert patients representatives by agency"
  ON public.patients_representatives FOR INSERT
  WITH CHECK (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can update patients representatives by agency" ON public.patients_representatives;
CREATE POLICY "Agency admins can update patients representatives by agency"
  ON public.patients_representatives FOR UPDATE
  USING (public.can_access_patient(patient_id))
  WITH CHECK (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can delete patients representatives by agency" ON public.patients_representatives;
CREATE POLICY "Agency admins can delete patients representatives by agency"
  ON public.patients_representatives FOR DELETE
  USING (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can view schedules by agency" ON public.schedules;
CREATE POLICY "Agency admins can view schedules by agency"
  ON public.schedules FOR SELECT
  USING (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can insert schedules by agency" ON public.schedules;
CREATE POLICY "Agency admins can insert schedules by agency"
  ON public.schedules FOR INSERT
  WITH CHECK (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can update schedules by agency" ON public.schedules;
CREATE POLICY "Agency admins can update schedules by agency"
  ON public.schedules FOR UPDATE
  USING (public.can_access_patient(patient_id))
  WITH CHECK (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can delete schedules by agency" ON public.schedules;
CREATE POLICY "Agency admins can delete schedules by agency"
  ON public.schedules FOR DELETE
  USING (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can view patient incidents by agency" ON public.patient_incidents;
CREATE POLICY "Agency admins can view patient incidents by agency"
  ON public.patient_incidents FOR SELECT
  USING (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can insert patient incidents by agency" ON public.patient_incidents;
CREATE POLICY "Agency admins can insert patient incidents by agency"
  ON public.patient_incidents FOR INSERT
  WITH CHECK (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can update patient incidents by agency" ON public.patient_incidents;
CREATE POLICY "Agency admins can update patient incidents by agency"
  ON public.patient_incidents FOR UPDATE
  USING (public.can_access_patient(patient_id))
  WITH CHECK (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can delete patient incidents by agency" ON public.patient_incidents;
CREATE POLICY "Agency admins can delete patient incidents by agency"
  ON public.patient_incidents FOR DELETE
  USING (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can view patient_adl_day_schedule by agency" ON public.patient_adl_day_schedule;
CREATE POLICY "Agency admins can view patient_adl_day_schedule by agency"
  ON public.patient_adl_day_schedule FOR SELECT
  USING (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can insert patient_adl_day_schedule by agency" ON public.patient_adl_day_schedule;
CREATE POLICY "Agency admins can insert patient_adl_day_schedule by agency"
  ON public.patient_adl_day_schedule FOR INSERT
  WITH CHECK (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can update patient_adl_day_schedule by agency" ON public.patient_adl_day_schedule;
CREATE POLICY "Agency admins can update patient_adl_day_schedule by agency"
  ON public.patient_adl_day_schedule FOR UPDATE
  USING (public.can_access_patient(patient_id))
  WITH CHECK (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can delete patient_adl_day_schedule by agency" ON public.patient_adl_day_schedule;
CREATE POLICY "Agency admins can delete patient_adl_day_schedule by agency"
  ON public.patient_adl_day_schedule FOR DELETE
  USING (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can view patient_contracted_hours by agency" ON public.patient_contracted_hours;
CREATE POLICY "Agency admins can view patient_contracted_hours by agency"
  ON public.patient_contracted_hours FOR SELECT
  USING (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can insert patient_contracted_hours by agency" ON public.patient_contracted_hours;
CREATE POLICY "Agency admins can insert patient_contracted_hours by agency"
  ON public.patient_contracted_hours FOR INSERT
  WITH CHECK (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can update patient_contracted_hours by agency" ON public.patient_contracted_hours;
CREATE POLICY "Agency admins can update patient_contracted_hours by agency"
  ON public.patient_contracted_hours FOR UPDATE
  USING (public.can_access_patient(patient_id))
  WITH CHECK (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "Agency admins can delete patient_contracted_hours by agency" ON public.patient_contracted_hours;
CREATE POLICY "Agency admins can delete patient_contracted_hours by agency"
  ON public.patient_contracted_hours FOR DELETE
  USING (public.can_access_patient(patient_id));

-- 6) Agency-scoped policies for caregivers/staff_members.
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agency admins can view staff by agency" ON public.staff_members;
CREATE POLICY "Agency admins can view staff by agency"
  ON public.staff_members FOR SELECT
  USING (public.can_access_agency(agency_id));

DROP POLICY IF EXISTS "Agency admins can insert staff by agency" ON public.staff_members;
CREATE POLICY "Agency admins can insert staff by agency"
  ON public.staff_members FOR INSERT
  WITH CHECK (public.can_access_agency(agency_id));

DROP POLICY IF EXISTS "Agency admins can update staff by agency" ON public.staff_members;
CREATE POLICY "Agency admins can update staff by agency"
  ON public.staff_members FOR UPDATE
  USING (public.can_access_agency(agency_id))
  WITH CHECK (public.can_access_agency(agency_id));

DROP POLICY IF EXISTS "Agency admins can delete staff by agency" ON public.staff_members;
CREATE POLICY "Agency admins can delete staff by agency"
  ON public.staff_members FOR DELETE
  USING (public.can_access_agency(agency_id));

