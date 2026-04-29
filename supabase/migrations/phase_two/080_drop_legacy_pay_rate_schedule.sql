-- Decommission legacy pay_rate_schedule table.
-- Runtime pay-rate resolution now uses caregiver_pay_rates only.

DROP TABLE IF EXISTS public.pay_rate_schedule;
