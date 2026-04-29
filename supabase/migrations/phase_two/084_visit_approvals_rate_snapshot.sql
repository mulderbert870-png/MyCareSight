-- Snapshot rates on approval records so profile rate edits never rewrite historical approvals.

ALTER TABLE public.visit_approvals
  ADD COLUMN IF NOT EXISTS pay_rate numeric(10,2),
  ADD COLUMN IF NOT EXISTS bill_rate numeric(10,2);

CREATE INDEX IF NOT EXISTS idx_visit_approvals_scheduled_visit_id
  ON public.visit_approvals(scheduled_visit_id);

-- Backfill from visit_financials where available.
UPDATE public.visit_approvals va
SET
  pay_rate = COALESCE(va.pay_rate, vf.pay_rate),
  bill_rate = COALESCE(va.bill_rate, vf.bill_rate),
  updated_at = now()
FROM public.visit_financials vf
WHERE vf.scheduled_visit_id = va.scheduled_visit_id
  AND (va.pay_rate IS NULL OR va.bill_rate IS NULL);
