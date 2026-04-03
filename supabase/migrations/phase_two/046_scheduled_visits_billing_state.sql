-- Time & billing workflow on the visit row (not visit_time_entries, which is for clocked time later).

alter table public.scheduled_visits
  add column if not exists billing_state text not null default 'pending',
  add column if not exists billing_hours numeric(10, 2),
  add column if not exists billing_note text;

alter table public.scheduled_visits
  drop constraint if exists scheduled_visits_billing_state_check;

alter table public.scheduled_visits
  add constraint scheduled_visits_billing_state_check
  check (billing_state in ('pending', 'approved', 'voided'));

comment on column public.scheduled_visits.billing_state is
  'Coordinator time & billing: pending | approved | voided (completed visits in Hours Approval UI).';

comment on column public.scheduled_visits.billing_hours is
  'Optional coordinator-adjusted billable hours; when null, UI derives hours from scheduled start/end.';

comment on column public.scheduled_visits.billing_note is
  'Optional coordinator note for time & billing (Hours Approval).';

-- Migrate existing data from visit_time_entries (legacy Hours Approval storage).
update public.scheduled_visits sv
set
  billing_state = case vte.entry_status
    when 'approved' then 'approved'
    when 'rejected' then 'voided'
    else 'pending'
  end,
  billing_hours = coalesce(vte.actual_hours, vte.billable_hours),
  billing_note = vte.adjustment_comment
from public.visit_time_entries vte
where vte.scheduled_visit_id = sv.id;
