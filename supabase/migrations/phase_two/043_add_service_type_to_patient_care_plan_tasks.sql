-- Add service_type discriminator for patient_care_plan_tasks.
-- Needed to separate non-skilled ADL plan rows from skilled care plan rows.

ALTER TABLE public.patient_care_plan_tasks
  ADD COLUMN IF NOT EXISTS service_type text;

-- Backfill from linked task_catalog when present; otherwise default to non_skilled.
UPDATE public.patient_care_plan_tasks pct
SET service_type = COALESCE(tc.service_type, 'non_skilled')
FROM public.task_catalog tc
WHERE pct.task_id = tc.id
  AND (pct.service_type IS NULL OR pct.service_type = '');

UPDATE public.patient_care_plan_tasks
SET service_type = 'non_skilled'
WHERE service_type IS NULL OR service_type = '';

ALTER TABLE public.patient_care_plan_tasks
  ALTER COLUMN service_type SET DEFAULT 'non_skilled';

ALTER TABLE public.patient_care_plan_tasks
  ALTER COLUMN service_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'patient_care_plan_tasks_service_type_check'
  ) THEN
    ALTER TABLE public.patient_care_plan_tasks
      ADD CONSTRAINT patient_care_plan_tasks_service_type_check
      CHECK (service_type IN ('non_skilled', 'skilled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_patient_care_plan_tasks_service_type
  ON public.patient_care_plan_tasks(service_type);

CREATE INDEX IF NOT EXISTS idx_patient_care_plan_tasks_patient_service
  ON public.patient_care_plan_tasks(patient_id, service_type);
