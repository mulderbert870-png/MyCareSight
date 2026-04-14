-- Backup existing scheduled_visits.status values, then make status DB-driven
-- with deterministic rules used by UI/API consumers.
--
-- Rules:
-- 1) If now is inside the scheduled window (date/time), status = in_progress.
-- 2) If visit is in the past:
--    - caregiver assigned -> completed
--    - caregiver not assigned -> missed
-- 3) If visit is in the future and caregiver is not assigned -> unassigned.
-- 4) Otherwise -> scheduled.

ALTER TABLE public.scheduled_visits
  ADD COLUMN IF NOT EXISTS status_backup_before_autosync text;

UPDATE public.scheduled_visits
SET status_backup_before_autosync = status
WHERE status_backup_before_autosync IS NULL;

CREATE OR REPLACE FUNCTION public.compute_scheduled_visit_status(
  p_visit_date date,
  p_start_time time,
  p_end_time time,
  p_caregiver_member_id uuid
) RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  now_ts timestamptz := now();
  start_ts timestamptz;
  end_ts timestamptz;
  day_start_ts timestamptz;
  day_end_ts timestamptz;
BEGIN
  day_start_ts := make_timestamptz(
    extract(year from p_visit_date)::int,
    extract(month from p_visit_date)::int,
    extract(day from p_visit_date)::int,
    0, 0, 0, 'UTC'
  );
  day_end_ts := day_start_ts + interval '1 day';
  start_ts := CASE
    WHEN p_start_time IS NULL THEN NULL
    ELSE make_timestamptz(
      extract(year from p_visit_date)::int,
      extract(month from p_visit_date)::int,
      extract(day from p_visit_date)::int,
      extract(hour from p_start_time)::int,
      extract(minute from p_start_time)::int,
      0,
      'UTC'
    )
  END;
  end_ts := CASE
    WHEN p_end_time IS NULL THEN NULL
    ELSE make_timestamptz(
      extract(year from p_visit_date)::int,
      extract(month from p_visit_date)::int,
      extract(day from p_visit_date)::int,
      extract(hour from p_end_time)::int,
      extract(minute from p_end_time)::int,
      0,
      'UTC'
    )
  END;

  IF start_ts IS NOT NULL AND end_ts IS NOT NULL AND now_ts >= start_ts AND now_ts <= end_ts THEN
    RETURN 'in_progress';
  END IF;

  IF start_ts IS NULL AND end_ts IS NULL AND now_ts >= day_start_ts AND now_ts < day_end_ts THEN
    RETURN 'in_progress';
  END IF;

  IF (end_ts IS NOT NULL AND now_ts > end_ts) OR (end_ts IS NULL AND now_ts >= day_end_ts) THEN
    IF p_caregiver_member_id IS NULL THEN
      RETURN 'missed';
    END IF;
    RETURN 'completed';
  END IF;

  IF p_caregiver_member_id IS NULL THEN
    RETURN 'unassigned';
  END IF;

  RETURN 'scheduled';
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_scheduled_visit_statuses(
  p_agency_id uuid DEFAULT NULL,
  p_patient_id uuid DEFAULT NULL,
  p_visit_ids uuid[] DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH changed AS (
    UPDATE public.scheduled_visits sv
    SET
      status = public.compute_scheduled_visit_status(
        sv.visit_date,
        sv.scheduled_start_time,
        sv.scheduled_end_time,
        sv.caregiver_member_id
      ),
      updated_at = now()
    WHERE
      (p_agency_id IS NULL OR sv.agency_id = p_agency_id)
      AND (p_patient_id IS NULL OR sv.patient_id = p_patient_id)
      AND (p_visit_ids IS NULL OR sv.id = ANY (p_visit_ids))
      AND sv.status IS DISTINCT FROM public.compute_scheduled_visit_status(
        sv.visit_date,
        sv.scheduled_start_time,
        sv.scheduled_end_time,
        sv.caregiver_member_id
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM changed;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.scheduled_visits_set_status_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.status := public.compute_scheduled_visit_status(
    NEW.visit_date,
    NEW.scheduled_start_time,
    NEW.scheduled_end_time,
    NEW.caregiver_member_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scheduled_visits_set_status_before_write ON public.scheduled_visits;
CREATE TRIGGER trg_scheduled_visits_set_status_before_write
BEFORE INSERT OR UPDATE OF visit_date, scheduled_start_time, scheduled_end_time, caregiver_member_id
ON public.scheduled_visits
FOR EACH ROW
EXECUTE FUNCTION public.scheduled_visits_set_status_before_write();

-- Initial backfill to align existing rows with DB-driven rules.
SELECT public.sync_scheduled_visit_statuses(NULL, NULL, NULL);

REVOKE ALL ON FUNCTION public.sync_scheduled_visit_statuses(uuid, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_scheduled_visit_statuses(uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_scheduled_visit_statuses(uuid, uuid, uuid[]) TO service_role;

COMMENT ON COLUMN public.scheduled_visits.status_backup_before_autosync IS
  'Backup snapshot of status before migration 059 switched status to DB auto-sync rules.';
