-- Seed billing codes used by Manage Service Contracts modal picklist.
-- Idempotent: upserts by unique code.

insert into public.billing_codes (code, name, unit_type, is_active)
values
  ('S5125', 'Attendant care services', 'hour', true),
  ('S5126', 'Attendant care services (per diem)', 'visit', true),
  ('T1019', 'Personal care services, per 15 minutes', '15_min_unit', true),
  ('T1020', 'Personal care services, per diem', 'visit', true),
  ('G0156', 'Services of home health/hospice aide', 'hour', true),
  ('G0159', 'Occupational therapy in home health setting', 'hour', true),
  ('97110', 'Therapeutic exercises', 'hour', true),
  ('97530', 'Therapeutic activities', 'hour', true),
  ('99509', 'Home visit for assistance with activities of daily living', 'visit', true),
  ('W1726', 'State-specific attendant/personal care code', 'hour', true)
on conflict (code) do update set
  name = excluded.name,
  unit_type = excluded.unit_type,
  is_active = excluded.is_active,
  updated_at = now();
