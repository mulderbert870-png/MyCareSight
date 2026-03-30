-- Copy legacy patient_contracted_hours, patient_adl_day_schedule, caregiver_requirements
-- into HomeSight tables (+ patient_skill_requirements). Idempotent via legacy_* ids / NOT EXISTS.

-- -------------------------------------------------------------------
-- 1) patient_contracted_hours → patient_service_contracts
-- -------------------------------------------------------------------
INSERT INTO public.patient_service_contracts (
  agency_id,
  patient_id,
  contract_name,
  contract_type,
  service_type,
  weekly_hours_limit,
  effective_date,
  end_date,
  status,
  note,
  legacy_patient_contracted_hours_id,
  created_at,
  updated_at
)
SELECT
  p.agency_id,
  pch.patient_id,
  NULL,
  'weekly_hours',
  'non_skilled',
  pch.total_hours,
  pch.effective_date,
  pch.end_date,
  'active',
  pch.note,
  pch.id,
  pch.created_at,
  pch.updated_at
FROM public.patient_contracted_hours pch
INNER JOIN public.patients p ON p.id = pch.patient_id AND p.agency_id IS NOT NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM public.patient_service_contracts x
  WHERE x.legacy_patient_contracted_hours_id = pch.id
);

-- -------------------------------------------------------------------
-- 2) patient_adl_day_schedule → patient_care_plan_tasks
-- -------------------------------------------------------------------
INSERT INTO public.patient_care_plan_tasks (
  agency_id,
  patient_id,
  task_id,
  legacy_task_code,
  day_of_week,
  schedule_type,
  times_per_day,
  slot_morning,
  slot_afternoon,
  slot_evening,
  slot_night,
  display_order,
  task_note,
  legacy_patient_adl_day_schedule_id,
  created_at,
  updated_at
)
SELECT
  p.agency_id,
  pad.patient_id,
  NULL,
  pad.adl_code,
  pad.day_of_week,
  pad.schedule_type,
  pad.times_per_day,
  pad.slot_morning,
  pad.slot_afternoon,
  pad.slot_evening,
  pad.slot_night,
  pad.display_order,
  pad.adl_note,
  pad.id,
  pad.created_at,
  pad.updated_at
FROM public.patient_adl_day_schedule pad
INNER JOIN public.patients p ON p.id = pad.patient_id AND p.agency_id IS NOT NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM public.patient_care_plan_tasks x
  WHERE x.legacy_patient_adl_day_schedule_id = pad.id
);

-- -------------------------------------------------------------------
-- 3) caregiver_requirements → patient_skill_requirements (same semantics, agency-scoped)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.patient_skill_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  skill_codes TEXT[] NOT NULL DEFAULT '{}',
  legacy_caregiver_requirements_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT patient_skill_requirements_patient_key UNIQUE (patient_id)
);

CREATE INDEX IF NOT EXISTS idx_patient_skill_requirements_agency_id
  ON public.patient_skill_requirements(agency_id);

CREATE INDEX IF NOT EXISTS idx_patient_skill_requirements_patient_id
  ON public.patient_skill_requirements(patient_id);

DROP TRIGGER IF EXISTS trg_patient_skill_requirements_updated_at ON public.patient_skill_requirements;
CREATE TRIGGER trg_patient_skill_requirements_updated_at
  BEFORE UPDATE ON public.patient_skill_requirements
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.patient_skill_requirements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "patient_skill_requirements_select" ON public.patient_skill_requirements;
CREATE POLICY "patient_skill_requirements_select"
  ON public.patient_skill_requirements FOR SELECT
  TO authenticated
  USING (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "patient_skill_requirements_insert" ON public.patient_skill_requirements;
CREATE POLICY "patient_skill_requirements_insert"
  ON public.patient_skill_requirements FOR INSERT
  TO authenticated
  WITH CHECK (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "patient_skill_requirements_update" ON public.patient_skill_requirements;
CREATE POLICY "patient_skill_requirements_update"
  ON public.patient_skill_requirements FOR UPDATE
  TO authenticated
  USING (public.can_access_patient(patient_id))
  WITH CHECK (public.can_access_patient(patient_id));

DROP POLICY IF EXISTS "patient_skill_requirements_delete" ON public.patient_skill_requirements;
CREATE POLICY "patient_skill_requirements_delete"
  ON public.patient_skill_requirements FOR DELETE
  TO authenticated
  USING (public.can_access_patient(patient_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_skill_requirements TO authenticated;

INSERT INTO public.patient_skill_requirements (
  agency_id,
  patient_id,
  skill_codes,
  legacy_caregiver_requirements_id,
  created_at,
  updated_at
)
SELECT
  p.agency_id,
  cr.patient_id,
  COALESCE(cr.skill_codes, '{}'),
  cr.id,
  cr.created_at,
  cr.updated_at
FROM public.caregiver_requirements cr
INNER JOIN public.patients p ON p.id = cr.patient_id AND p.agency_id IS NOT NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM public.patient_skill_requirements x
  WHERE x.legacy_caregiver_requirements_id = cr.id
);

-- Upserts from the app (replaces patient_adl_day_schedule unique constraint)
CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_care_plan_tasks_patient_adl_dow
  ON public.patient_care_plan_tasks (patient_id, legacy_task_code, day_of_week);
