-- H4: Time-driven scheduled_visits.status is recomputed on an interval instead of on every app read
-- (see src/lib/supabase/query/schedules.ts). INSERT/UPDATE of visit date/time or caregiver still
-- refreshes status via trigger scheduled_visits_set_status_before_write.
--
-- Pre-deploy checklist (this migration will FAIL without these):
--   1. Enable pg_cron: Supabase Dashboard → Database → Extensions → pg_cron (or enable locally).
--   2. Do not skip this migration: if it never runs, sync_scheduled_visit_statuses is never scheduled
--      and visits past their window can stay "scheduled" until the row is edited.
-- Runs every 5 minutes UTC; tighten the cron expression if UI status freshness must be sub-minute.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Idempotent: remove prior job if this migration is re-applied.
SELECT cron.unschedule(j.jobid)
FROM cron.job AS j
WHERE j.jobname = 'sync_scheduled_visit_statuses';

SELECT cron.schedule(
  'sync_scheduled_visit_statuses',
  '*/5 * * * *',
  $cmd$SELECT public.sync_scheduled_visit_statuses(NULL::uuid, NULL::uuid, NULL::uuid[])$cmd$
);
