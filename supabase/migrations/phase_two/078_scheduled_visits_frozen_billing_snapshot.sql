-- Freeze billing values on scheduled_visits for non-pending rows.
-- This prevents later contract edits from changing approved/voided rows in UI reports.

ALTER TABLE public.scheduled_visits
  ADD COLUMN IF NOT EXISTS billing_rate numeric(10, 2),
  ADD COLUMN IF NOT EXISTS billing_amount numeric(10, 2);

COMMENT ON COLUMN public.scheduled_visits.billing_rate IS
  'Frozen bill rate captured when visit is approved/voided (or snapshotted before contract change).';
COMMENT ON COLUMN public.scheduled_visits.billing_amount IS
  'Frozen bill amount captured with billing_rate for approved/voided rows.';
