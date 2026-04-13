-- One materialized row per (visit_series, calendar day) so rolling-window refill stays idempotent.
-- If this fails, dedupe existing scheduled_visits that share the same visit_series_id + visit_date.
--
-- After migrate: deploy Edge Function `refill-visit-series`, set secret CRON_SECRET, then in
-- Supabase Dashboard schedule the function daily (e.g. 06:00 UTC). Use header:
--   Authorization: Bearer <CRON_SECRET>

CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_visits_visit_series_visit_date_unique
  ON public.scheduled_visits (visit_series_id, visit_date)
  WHERE visit_series_id IS NOT NULL;

COMMENT ON INDEX public.idx_scheduled_visits_visit_series_visit_date_unique IS
  'Ensures refill-visit-series Edge Function can insert missing dates without duplicates.';
