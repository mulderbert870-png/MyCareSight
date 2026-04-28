-- Reference billing_codes used by service contracts and ClientDetailContent picklist (BILLING_CODE_PICKLIST_ORDER).
-- The homesight backbone creates the table but does not seed rows; without rows the billing code <select> is empty.

insert into public.billing_codes (code, name, unit_type, is_active)
values
  ('S5125', 'S5125', 'hour', true),
  ('S5126', 'S5126', 'hour', true),
  ('T1019', 'T1019', 'hour', true),
  ('T1020', 'T1020', 'visit', true),
  ('G0156', 'G0156', 'hour', true),
  ('G0159', 'G0159', 'hour', true),
  ('97110', '97110', 'hour', true),
  ('97530', '97530', 'hour', true),
  ('99509', '99509', 'visit', true),
  ('W1726', 'W1726', 'hour', true)
on conflict (code) do nothing;
