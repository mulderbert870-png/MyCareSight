-- Explicit care coordinator read access for patients on same agency.
-- This avoids relying only on shared helper functions for the clients page.

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients_representatives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Care coordinators can view patients by agency" ON public.patients;
CREATE POLICY "Care coordinators can view patients by agency"
  ON public.patients FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.care_coordinators cc
      WHERE cc.user_id = auth.uid()
        AND cc.agency_id = patients.agency_id
        AND COALESCE(cc.status, 'active') IN ('active', 'invited', 'pending')
    )
  );

DROP POLICY IF EXISTS "Care coordinators can view patients representatives by agency" ON public.patients_representatives;
CREATE POLICY "Care coordinators can view patients representatives by agency"
  ON public.patients_representatives FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.patients p
      JOIN public.care_coordinators cc
        ON cc.agency_id = p.agency_id
      WHERE p.id = patients_representatives.patient_id
        AND cc.user_id = auth.uid()
        AND COALESCE(cc.status, 'active') IN ('active', 'invited', 'pending')
    )
  );
