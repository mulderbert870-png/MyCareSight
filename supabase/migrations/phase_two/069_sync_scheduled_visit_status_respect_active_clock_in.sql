-- Do not overwrite scheduled_visits.status during autosync when the caregiver has an
-- active EVV session (clock in without clock out). Otherwise clock-in sets in_progress
-- but the next list load runs sync_scheduled_visit_statuses and reverts to scheduled
-- whenever "now" is outside the scheduled window — visits disappear from In Progress.

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
      AND NOT EXISTS (
        SELECT 1
        FROM public.visit_time_entries vte
        WHERE vte.scheduled_visit_id = sv.id
          AND vte.clock_in_time IS NOT NULL
          AND vte.clock_out_time IS NULL
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM changed;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.sync_scheduled_visit_statuses(uuid, uuid, uuid[]) IS
  'Recompute scheduled_visits.status from date/time/caregiver; skips rows with an active EVV clock-in (open visit_time_entries).';
