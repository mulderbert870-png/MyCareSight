-- One materialized row per (visit_series, calendar day) so rolling-window refill stays idempotent.
-- If this fails, dedupe existing scheduled_visits that share the same visit_series_id + visit_date.
--
-- After migrate: deploy Edge Function `refill-visit-series`, set secret CRON_SECRET, then schedule daily.
-- Intended run: 23:00 UTC (11:00 PM UTC). pg_cron cron expression: `0 23 * * *`.
-- Invoke with header: Authorization: Bearer <CRON_SECRET>
-- If using net.http_post from pg_cron, set timeout_milliseconds (default 2000 is too low), e.g. 300000.
-- Refill logic: see Edge Function — UTC dates; when today’s UTC weekday is in days_of_week, insert at most
-- one visit on todayUTC+21 (same weekday in “week 4”).

-- Important: ON CONFLICT (visit_series_id, visit_date) requires a matching non-partial unique index/constraint.
-- A partial unique index cannot be inferred by ON CONFLICT unless its predicate is included.
DROP INDEX IF EXISTS public.idx_scheduled_visits_visit_series_visit_date_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_visits_visit_series_visit_date_unique
  ON public.scheduled_visits (visit_series_id, visit_date);

COMMENT ON INDEX public.idx_scheduled_visits_visit_series_visit_date_unique IS
  'Ensures refill-visit-series Edge Function can insert missing dates without duplicates.';
