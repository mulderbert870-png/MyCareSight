-- One row per (patient, skilled task, day_of_week); backfill missing days for existing skilled tasks.

-- Remove duplicate skilled rows for same patient / task / day (keep arbitrary winner).
DELETE FROM public.patient_care_plan_tasks a
USING public.patient_care_plan_tasks b
WHERE a.service_type = 'skilled'
  AND b.service_type = 'skilled'
  AND a.patient_id = b.patient_id
  AND a.task_id IS NOT NULL
  AND a.task_id = b.task_id
  AND a.day_of_week = b.day_of_week
  AND a.ctid < b.ctid;

-- Insert missing day rows (default never) for each distinct skilled task on the plan.
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
  service_type
)
SELECT
  t.agency_id,
  t.patient_id,
  t.task_id,
  NULL,
  gs.dow,
  CASE
    WHEN gs.dow = t.day_of_week THEN COALESCE(t.schedule_type, 'never')
    ELSE 'never'
  END,
  CASE WHEN gs.dow = t.day_of_week THEN t.times_per_day ELSE NULL END,
  CASE WHEN gs.dow = t.day_of_week THEN t.slot_morning ELSE NULL END,
  CASE WHEN gs.dow = t.day_of_week THEN t.slot_afternoon ELSE NULL END,
  CASE WHEN gs.dow = t.day_of_week THEN t.slot_evening ELSE NULL END,
  CASE WHEN gs.dow = t.day_of_week THEN t.slot_night ELSE NULL END,
  t.display_order,
  NULL,
  'skilled'
FROM (
  SELECT DISTINCT ON (patient_id, task_id)
    agency_id,
    patient_id,
    task_id,
    day_of_week,
    schedule_type,
    times_per_day,
    slot_morning,
    slot_afternoon,
    slot_evening,
    slot_night,
    display_order
  FROM public.patient_care_plan_tasks
  WHERE service_type = 'skilled'
    AND task_id IS NOT NULL
  ORDER BY patient_id, task_id, day_of_week
) t
CROSS JOIN LATERAL generate_series(1, 7) AS gs(dow)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.patient_care_plan_tasks x
  WHERE x.patient_id = t.patient_id
    AND x.task_id = t.task_id
    AND x.service_type = 'skilled'
    AND x.day_of_week = gs.dow
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_care_plan_tasks_patient_skilled_task_dow
  ON public.patient_care_plan_tasks (patient_id, task_id, day_of_week)
  WHERE service_type = 'skilled' AND task_id IS NOT NULL;
