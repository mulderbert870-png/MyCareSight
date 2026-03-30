-- Run only after application code uses scheduled_visits (migration 030 applied).
-- Drops legacy schedules; visit data lives in scheduled_visits + scheduled_visit_tasks.

DROP TABLE IF EXISTS public.schedules CASCADE;
