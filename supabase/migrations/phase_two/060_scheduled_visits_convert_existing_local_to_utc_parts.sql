-- One-time conversion for existing scheduled_visits rows:
-- treat current visit_date + scheduled_*_time as local wall clock (DB timezone),
-- convert to UTC date/time parts, and store back in the same columns.
--
-- Safety: keeps backup columns for pre-conversion values.

ALTER TABLE public.scheduled_visits
  ADD COLUMN IF NOT EXISTS visit_date_backup_before_utc date,
  ADD COLUMN IF NOT EXISTS scheduled_start_time_backup_before_utc time,
  ADD COLUMN IF NOT EXISTS scheduled_end_time_backup_before_utc time;

UPDATE public.scheduled_visits
SET
  visit_date_backup_before_utc = COALESCE(visit_date_backup_before_utc, visit_date),
  scheduled_start_time_backup_before_utc = COALESCE(scheduled_start_time_backup_before_utc, scheduled_start_time),
  scheduled_end_time_backup_before_utc = COALESCE(scheduled_end_time_backup_before_utc, scheduled_end_time)
WHERE
  visit_date_backup_before_utc IS NULL
  OR scheduled_start_time_backup_before_utc IS NULL
  OR scheduled_end_time_backup_before_utc IS NULL;

WITH converted AS (
  SELECT
    id,
    (
      ((visit_date + COALESCE(scheduled_start_time, '00:00'::time))::timestamp AT TIME ZONE current_setting('TIMEZONE'))
      AT TIME ZONE 'UTC'
    ) AS start_utc_ts,
    (
      CASE
        WHEN scheduled_end_time IS NULL THEN NULL
        ELSE (((visit_date + scheduled_end_time)::timestamp AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'UTC')
      END
    ) AS end_utc_ts
  FROM public.scheduled_visits
)
UPDATE public.scheduled_visits sv
SET
  visit_date = (c.start_utc_ts)::date,
  scheduled_start_time = CASE WHEN sv.scheduled_start_time IS NULL THEN NULL ELSE (c.start_utc_ts)::time END,
  scheduled_end_time = CASE WHEN sv.scheduled_end_time IS NULL THEN NULL ELSE (c.end_utc_ts)::time END,
  updated_at = now()
FROM converted c
WHERE sv.id = c.id;

COMMENT ON COLUMN public.scheduled_visits.visit_date_backup_before_utc IS
  'Backup snapshot before migration 060 converted local date/time values to UTC date/time parts.';
COMMENT ON COLUMN public.scheduled_visits.scheduled_start_time_backup_before_utc IS
  'Backup snapshot before migration 060 converted local date/time values to UTC date/time parts.';
COMMENT ON COLUMN public.scheduled_visits.scheduled_end_time_backup_before_utc IS
  'Backup snapshot before migration 060 converted local date/time values to UTC date/time parts.';
