-- HomeSight schema backbone (migration 028)
-- Source: database_update_plan/homesight_schema_backbone(1).sql
-- Assumptions:
-- 1) auth.uid() = user_profiles.id
-- 2) Existing tables remain in place during migration:
--    agencies, user_profiles, staff_members, care_coordinators, patients, licensing_experts, clients
-- 3) Creates NEW backbone tables only; does not rename or drop legacy tables.
-- 4) hs_is_agency_admin() treats legacy public.clients (company_owner_id = auth.uid(), agency_id match)
--    as agency admins so RLS works before agency_admins rows are backfilled.

create extension if not exists pgcrypto;

-- -------------------------------------------------------------------
-- Common helper: updated_at trigger
-- -------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -------------------------------------------------------------------
-- 1. agency_admins
-- New table replacing the legacy meaning of clients.
-- Carries forward legacy fields so data can be mapped directly.
-- -------------------------------------------------------------------
create table if not exists public.agency_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.user_profiles(id) on delete set null,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  expert_id uuid references public.licensing_experts(id) on delete set null,
  company_owner_id uuid,
  company_name text,
  contact_name text,
  contact_email text,
  contact_phone text,
  status text,
  start_date date,
  business_type text,
  tax_id text,
  primary_license_number text,
  website text,
  physical_street_address text,
  physical_city text,
  physical_state text,
  physical_zip_code text,
  mailing_street_address text,
  mailing_city text,
  mailing_state text,
  mailing_zip_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agency_admins_agency_id on public.agency_admins(agency_id);
create index if not exists idx_agency_admins_user_id on public.agency_admins(user_id);

drop trigger if exists trg_agency_admins_updated_at on public.agency_admins;
create trigger trg_agency_admins_updated_at
before update on public.agency_admins
for each row execute function public.set_updated_at();

-- RLS helpers must be created after agency_admins exists (Postgres validates SQL bodies).
-- -------------------------------------------------------------------
-- RLS helper functions (SECURITY DEFINER: membership checks must not recurse through RLS)
-- -------------------------------------------------------------------
create or replace function public.hs_is_agency_admin(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.agency_admins aa
    where aa.agency_id = p_agency_id
      and aa.user_id = auth.uid()
      and coalesce(aa.status, 'active') in ('active','invited')
  )
  or exists (
    select 1
    from public.clients c
    where c.agency_id = p_agency_id
      and c.company_owner_id = auth.uid()
  );
$$;

create or replace function public.hs_is_care_coordinator(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.care_coordinators cc
    where cc.agency_id = p_agency_id
      and cc.user_id = auth.uid()
      and coalesce(cc.status, 'active') in ('active','invited')
  );
$$;

create or replace function public.hs_is_staff_member(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_members sm
    where sm.agency_id = p_agency_id
      and sm.user_id = auth.uid()
      and coalesce(sm.status, 'active') in ('active','invited')
  );
$$;

create or replace function public.hs_can_access_agency(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.hs_is_agency_admin(p_agency_id)
    or public.hs_is_care_coordinator(p_agency_id)
    or public.hs_is_staff_member(p_agency_id);
$$;

create or replace function public.hs_can_manage_agency(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.hs_is_agency_admin(p_agency_id)
    or public.hs_is_care_coordinator(p_agency_id);
$$;

grant execute on function public.hs_is_agency_admin(uuid) to authenticated;
grant execute on function public.hs_is_care_coordinator(uuid) to authenticated;
grant execute on function public.hs_is_staff_member(uuid) to authenticated;
grant execute on function public.hs_can_access_agency(uuid) to authenticated;
grant execute on function public.hs_can_manage_agency(uuid) to authenticated;

alter table public.agency_admins enable row level security;

drop policy if exists "agency_admins_select" on public.agency_admins;
create policy "agency_admins_select"
on public.agency_admins for select
to authenticated
using (
  user_id = auth.uid() or public.hs_can_access_agency(agency_id)
);

drop policy if exists "agency_admins_insert" on public.agency_admins;
create policy "agency_admins_insert"
on public.agency_admins for insert
to authenticated
with check (
  public.hs_is_agency_admin(agency_id)
);

drop policy if exists "agency_admins_update" on public.agency_admins;
create policy "agency_admins_update"
on public.agency_admins for update
to authenticated
using (public.hs_is_agency_admin(agency_id))
with check (public.hs_is_agency_admin(agency_id));

drop policy if exists "agency_admins_delete" on public.agency_admins;
create policy "agency_admins_delete"
on public.agency_admins for delete
to authenticated
using (public.hs_is_agency_admin(agency_id));

-- -------------------------------------------------------------------
-- 2. task_catalog
-- -------------------------------------------------------------------
create table if not exists public.task_catalog (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null,
  service_type text not null,
  description text,
  is_skilled boolean not null default false,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_catalog_service_type_check
    check (service_type in ('non_skilled','skilled'))
);

drop trigger if exists trg_task_catalog_updated_at on public.task_catalog;
create trigger trg_task_catalog_updated_at
before update on public.task_catalog
for each row execute function public.set_updated_at();

alter table public.task_catalog enable row level security;

drop policy if exists "task_catalog_select" on public.task_catalog;
create policy "task_catalog_select"
on public.task_catalog for select
to authenticated
using (true);

-- No client-side write policy for reference data by default.

-- -------------------------------------------------------------------
-- 3. credential_catalog
-- -------------------------------------------------------------------
create table if not exists public.credential_catalog (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  credential_type text not null,
  service_type text,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credential_catalog_type_check
    check (credential_type in ('license','certification','skill','role'))
);

drop trigger if exists trg_credential_catalog_updated_at on public.credential_catalog;
create trigger trg_credential_catalog_updated_at
before update on public.credential_catalog
for each row execute function public.set_updated_at();

alter table public.credential_catalog enable row level security;

drop policy if exists "credential_catalog_select" on public.credential_catalog;
create policy "credential_catalog_select"
on public.credential_catalog for select
to authenticated
using (true);

-- -------------------------------------------------------------------
-- 4. task_required_credentials
-- -------------------------------------------------------------------
create table if not exists public.task_required_credentials (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task_catalog(id) on delete cascade,
  credential_id uuid not null references public.credential_catalog(id) on delete cascade,
  requirement_type text not null default 'required',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(task_id, credential_id),
  constraint task_required_credentials_requirement_type_check
    check (requirement_type in ('required','preferred'))
);

create index if not exists idx_task_required_credentials_task_id
  on public.task_required_credentials(task_id);

drop trigger if exists trg_task_required_credentials_updated_at on public.task_required_credentials;
create trigger trg_task_required_credentials_updated_at
before update on public.task_required_credentials
for each row execute function public.set_updated_at();

alter table public.task_required_credentials enable row level security;

drop policy if exists "task_required_credentials_select" on public.task_required_credentials;
create policy "task_required_credentials_select"
on public.task_required_credentials for select
to authenticated
using (true);

-- -------------------------------------------------------------------
-- 5. billing_codes
-- -------------------------------------------------------------------
create table if not exists public.billing_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  unit_type text not null,
  rate numeric(10,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_codes_unit_type_check
    check (unit_type in ('hour','visit','15_min_unit'))
);

drop trigger if exists trg_billing_codes_updated_at on public.billing_codes;
create trigger trg_billing_codes_updated_at
before update on public.billing_codes
for each row execute function public.set_updated_at();

alter table public.billing_codes enable row level security;

drop policy if exists "billing_codes_select" on public.billing_codes;
create policy "billing_codes_select"
on public.billing_codes for select
to authenticated
using (true);

-- -------------------------------------------------------------------
-- 6. task_billing_map
-- -------------------------------------------------------------------
create table if not exists public.task_billing_map (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.task_catalog(id) on delete cascade,
  billing_code_id uuid not null references public.billing_codes(id) on delete restrict,
  notes text,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(task_id, billing_code_id)
);

create index if not exists idx_task_billing_map_task_id
  on public.task_billing_map(task_id);

drop trigger if exists trg_task_billing_map_updated_at on public.task_billing_map;
create trigger trg_task_billing_map_updated_at
before update on public.task_billing_map
for each row execute function public.set_updated_at();

alter table public.task_billing_map enable row level security;

drop policy if exists "task_billing_map_select" on public.task_billing_map;
create policy "task_billing_map_select"
on public.task_billing_map for select
to authenticated
using (true);

-- -------------------------------------------------------------------
-- 7. staff_credentials
-- Consolidates staff_licenses + certifications + skills.
-- Includes document_url and direct-mapping support fields.
-- -------------------------------------------------------------------
create table if not exists public.staff_credentials (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  staff_member_id uuid references public.staff_members(id) on delete cascade,
  user_id uuid references public.user_profiles(id) on delete set null,
  credential_id uuid references public.credential_catalog(id) on delete set null,
  source_credential_name text,
  credential_number text,
  state text,
  issue_date date,
  expiration_date date,
  issuing_authority text,
  status text,
  document_url text,
  verified boolean not null default false,
  source_table text,
  source_record_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_staff_credentials_agency_id on public.staff_credentials(agency_id);
create index if not exists idx_staff_credentials_staff_member_id on public.staff_credentials(staff_member_id);
create index if not exists idx_staff_credentials_user_id on public.staff_credentials(user_id);

drop trigger if exists trg_staff_credentials_updated_at on public.staff_credentials;
create trigger trg_staff_credentials_updated_at
before update on public.staff_credentials
for each row execute function public.set_updated_at();

alter table public.staff_credentials enable row level security;

drop policy if exists "staff_credentials_select" on public.staff_credentials;
create policy "staff_credentials_select"
on public.staff_credentials for select
to authenticated
using (public.hs_can_access_agency(agency_id));

drop policy if exists "staff_credentials_insert" on public.staff_credentials;
create policy "staff_credentials_insert"
on public.staff_credentials for insert
to authenticated
with check (public.hs_can_manage_agency(agency_id));

drop policy if exists "staff_credentials_update" on public.staff_credentials;
create policy "staff_credentials_update"
on public.staff_credentials for update
to authenticated
using (public.hs_can_manage_agency(agency_id))
with check (public.hs_can_manage_agency(agency_id));

drop policy if exists "staff_credentials_delete" on public.staff_credentials;
create policy "staff_credentials_delete"
on public.staff_credentials for delete
to authenticated
using (public.hs_is_agency_admin(agency_id));

-- -------------------------------------------------------------------
-- 8. patient_service_contracts
-- Expands patient_contracted_hours into contract-by-service-type rules.
-- -------------------------------------------------------------------
create table if not exists public.patient_service_contracts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  contract_name text,
  contract_type text not null,
  service_type text not null,
  billing_code_id uuid references public.billing_codes(id) on delete set null,
  bill_rate numeric(10,2),
  bill_unit_type text not null default 'hour',
  weekly_hours_limit numeric(10,2),
  effective_date date not null,
  end_date date,
  status text not null default 'active',
  note text,
  legacy_patient_contracted_hours_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_service_contracts_service_type_check
    check (service_type in ('non_skilled','skilled')),
  constraint patient_service_contracts_bill_unit_type_check
    check (bill_unit_type in ('hour','visit','15_min_unit'))
);

create index if not exists idx_patient_service_contracts_agency_id on public.patient_service_contracts(agency_id);
create index if not exists idx_patient_service_contracts_patient_id on public.patient_service_contracts(patient_id);

drop trigger if exists trg_patient_service_contracts_updated_at on public.patient_service_contracts;
create trigger trg_patient_service_contracts_updated_at
before update on public.patient_service_contracts
for each row execute function public.set_updated_at();

alter table public.patient_service_contracts enable row level security;

drop policy if exists "patient_service_contracts_select" on public.patient_service_contracts;
create policy "patient_service_contracts_select"
on public.patient_service_contracts for select
to authenticated
using (public.hs_can_access_agency(agency_id));

drop policy if exists "patient_service_contracts_insert" on public.patient_service_contracts;
create policy "patient_service_contracts_insert"
on public.patient_service_contracts for insert
to authenticated
with check (public.hs_can_manage_agency(agency_id));

drop policy if exists "patient_service_contracts_update" on public.patient_service_contracts;
create policy "patient_service_contracts_update"
on public.patient_service_contracts for update
to authenticated
using (public.hs_can_manage_agency(agency_id))
with check (public.hs_can_manage_agency(agency_id));

drop policy if exists "patient_service_contracts_delete" on public.patient_service_contracts;
create policy "patient_service_contracts_delete"
on public.patient_service_contracts for delete
to authenticated
using (public.hs_is_agency_admin(agency_id));

-- -------------------------------------------------------------------
-- 9. patient_care_plan_tasks
-- Row-based replacement for patient_adl_day_schedule
-- -------------------------------------------------------------------
create table if not exists public.patient_care_plan_tasks (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  task_id uuid references public.task_catalog(id) on delete set null,
  legacy_task_code text,
  day_of_week smallint not null,
  schedule_type text,
  times_per_day smallint,
  slot_morning text,
  slot_afternoon text,
  slot_evening text,
  slot_night text,
  display_order integer not null default 0,
  task_note text,
  legacy_patient_adl_day_schedule_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_patient_care_plan_tasks_patient_id
  on public.patient_care_plan_tasks(patient_id);

drop trigger if exists trg_patient_care_plan_tasks_updated_at on public.patient_care_plan_tasks;
create trigger trg_patient_care_plan_tasks_updated_at
before update on public.patient_care_plan_tasks
for each row execute function public.set_updated_at();

alter table public.patient_care_plan_tasks enable row level security;

drop policy if exists "patient_care_plan_tasks_select" on public.patient_care_plan_tasks;
create policy "patient_care_plan_tasks_select"
on public.patient_care_plan_tasks for select
to authenticated
using (public.hs_can_access_agency(agency_id));

drop policy if exists "patient_care_plan_tasks_insert" on public.patient_care_plan_tasks;
create policy "patient_care_plan_tasks_insert"
on public.patient_care_plan_tasks for insert
to authenticated
with check (public.hs_can_manage_agency(agency_id));

drop policy if exists "patient_care_plan_tasks_update" on public.patient_care_plan_tasks;
create policy "patient_care_plan_tasks_update"
on public.patient_care_plan_tasks for update
to authenticated
using (public.hs_can_manage_agency(agency_id))
with check (public.hs_can_manage_agency(agency_id));

drop policy if exists "patient_care_plan_tasks_delete" on public.patient_care_plan_tasks;
create policy "patient_care_plan_tasks_delete"
on public.patient_care_plan_tasks for delete
to authenticated
using (public.hs_is_agency_admin(agency_id));

-- -------------------------------------------------------------------
-- 10. visit_series
-- Recurring visit template (not the actual worked visit)
-- -------------------------------------------------------------------
create table if not exists public.visit_series (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  primary_staff_member_id uuid references public.staff_members(id) on delete set null,
  contract_id uuid references public.patient_service_contracts(id) on delete set null,
  service_type text not null,
  series_name text,
  repeat_frequency text,
  days_of_week smallint[],
  repeat_start date not null,
  repeat_end date,
  repeat_monthly_rules jsonb,
  notes text,
  status text not null default 'active',
  legacy_schedule_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visit_series_service_type_check
    check (service_type in ('non_skilled','skilled'))
);

create index if not exists idx_visit_series_agency_id on public.visit_series(agency_id);
create index if not exists idx_visit_series_patient_id on public.visit_series(patient_id);

drop trigger if exists trg_visit_series_updated_at on public.visit_series;
create trigger trg_visit_series_updated_at
before update on public.visit_series
for each row execute function public.set_updated_at();

alter table public.visit_series enable row level security;

drop policy if exists "visit_series_select" on public.visit_series;
create policy "visit_series_select"
on public.visit_series for select
to authenticated
using (public.hs_can_access_agency(agency_id));

drop policy if exists "visit_series_insert" on public.visit_series;
create policy "visit_series_insert"
on public.visit_series for insert
to authenticated
with check (public.hs_can_manage_agency(agency_id));

drop policy if exists "visit_series_update" on public.visit_series;
create policy "visit_series_update"
on public.visit_series for update
to authenticated
using (public.hs_can_manage_agency(agency_id))
with check (public.hs_can_manage_agency(agency_id));

drop policy if exists "visit_series_delete" on public.visit_series;
create policy "visit_series_delete"
on public.visit_series for delete
to authenticated
using (public.hs_is_agency_admin(agency_id));

-- -------------------------------------------------------------------
-- 11. scheduled_visits
-- Actual dated visit instance
-- -------------------------------------------------------------------
create table if not exists public.scheduled_visits (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  visit_series_id uuid references public.visit_series(id) on delete set null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  staff_member_id uuid references public.staff_members(id) on delete set null,
  contract_id uuid references public.patient_service_contracts(id) on delete set null,
  service_type text not null,
  visit_date date not null,
  scheduled_start_time time,
  scheduled_end_time time,
  description text,
  notes text,
  visit_type text,
  status text not null default 'scheduled',
  created_by_user_id uuid references public.user_profiles(id) on delete set null,
  updated_by_user_id uuid references public.user_profiles(id) on delete set null,
  legacy_schedule_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_visits_service_type_check
    check (service_type in ('non_skilled','skilled'))
);

create index if not exists idx_scheduled_visits_agency_id on public.scheduled_visits(agency_id);
create index if not exists idx_scheduled_visits_patient_id on public.scheduled_visits(patient_id);
create index if not exists idx_scheduled_visits_staff_member_id on public.scheduled_visits(staff_member_id);

drop trigger if exists trg_scheduled_visits_updated_at on public.scheduled_visits;
create trigger trg_scheduled_visits_updated_at
before update on public.scheduled_visits
for each row execute function public.set_updated_at();

alter table public.scheduled_visits enable row level security;

drop policy if exists "scheduled_visits_select" on public.scheduled_visits;
create policy "scheduled_visits_select"
on public.scheduled_visits for select
to authenticated
using (public.hs_can_access_agency(agency_id));

drop policy if exists "scheduled_visits_insert" on public.scheduled_visits;
create policy "scheduled_visits_insert"
on public.scheduled_visits for insert
to authenticated
with check (public.hs_can_manage_agency(agency_id));

drop policy if exists "scheduled_visits_update" on public.scheduled_visits;
create policy "scheduled_visits_update"
on public.scheduled_visits for update
to authenticated
using (
  public.hs_can_manage_agency(agency_id)
  or (public.hs_is_staff_member(agency_id) and staff_member_id in (
        select sm.id from public.staff_members sm where sm.user_id = auth.uid()
      ))
)
with check (
  public.hs_can_manage_agency(agency_id)
  or (public.hs_is_staff_member(agency_id) and staff_member_id in (
        select sm.id from public.staff_members sm where sm.user_id = auth.uid()
      ))
);

drop policy if exists "scheduled_visits_delete" on public.scheduled_visits;
create policy "scheduled_visits_delete"
on public.scheduled_visits for delete
to authenticated
using (public.hs_is_agency_admin(agency_id));

-- -------------------------------------------------------------------
-- 12. scheduled_visit_tasks
-- -------------------------------------------------------------------
create table if not exists public.scheduled_visit_tasks (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  scheduled_visit_id uuid not null references public.scheduled_visits(id) on delete cascade,
  task_id uuid references public.task_catalog(id) on delete set null,
  legacy_task_code text,
  sort_order integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_scheduled_visit_tasks_visit_id
  on public.scheduled_visit_tasks(scheduled_visit_id);

drop trigger if exists trg_scheduled_visit_tasks_updated_at on public.scheduled_visit_tasks;
create trigger trg_scheduled_visit_tasks_updated_at
before update on public.scheduled_visit_tasks
for each row execute function public.set_updated_at();

alter table public.scheduled_visit_tasks enable row level security;

drop policy if exists "scheduled_visit_tasks_select" on public.scheduled_visit_tasks;
create policy "scheduled_visit_tasks_select"
on public.scheduled_visit_tasks for select
to authenticated
using (public.hs_can_access_agency(agency_id));

drop policy if exists "scheduled_visit_tasks_insert" on public.scheduled_visit_tasks;
create policy "scheduled_visit_tasks_insert"
on public.scheduled_visit_tasks for insert
to authenticated
with check (public.hs_can_manage_agency(agency_id));

drop policy if exists "scheduled_visit_tasks_update" on public.scheduled_visit_tasks;
create policy "scheduled_visit_tasks_update"
on public.scheduled_visit_tasks for update
to authenticated
using (public.hs_can_manage_agency(agency_id))
with check (public.hs_can_manage_agency(agency_id));

drop policy if exists "scheduled_visit_tasks_delete" on public.scheduled_visit_tasks;
create policy "scheduled_visit_tasks_delete"
on public.scheduled_visit_tasks for delete
to authenticated
using (public.hs_is_agency_admin(agency_id));

-- -------------------------------------------------------------------
-- 13. visit_time_entries
-- -------------------------------------------------------------------
create table if not exists public.visit_time_entries (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  scheduled_visit_id uuid not null unique references public.scheduled_visits(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  staff_member_id uuid not null references public.staff_members(id) on delete restrict,
  clock_in_time timestamptz,
  clock_out_time timestamptz,
  adjusted_start_time timestamptz,
  adjusted_end_time timestamptz,
  actual_hours numeric(10,2),
  billable_hours numeric(10,2),
  entry_status text not null default 'pending_review',
  adjustment_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visit_time_entries_status_check
    check (entry_status in ('pending_review','submitted','approved','rejected'))
);

create index if not exists idx_visit_time_entries_agency_id on public.visit_time_entries(agency_id);

drop trigger if exists trg_visit_time_entries_updated_at on public.visit_time_entries;
create trigger trg_visit_time_entries_updated_at
before update on public.visit_time_entries
for each row execute function public.set_updated_at();

alter table public.visit_time_entries enable row level security;

drop policy if exists "visit_time_entries_select" on public.visit_time_entries;
create policy "visit_time_entries_select"
on public.visit_time_entries for select
to authenticated
using (public.hs_can_access_agency(agency_id));

drop policy if exists "visit_time_entries_insert" on public.visit_time_entries;
create policy "visit_time_entries_insert"
on public.visit_time_entries for insert
to authenticated
with check (
  public.hs_can_manage_agency(agency_id)
  or (public.hs_is_staff_member(agency_id) and staff_member_id in (
        select sm.id from public.staff_members sm where sm.user_id = auth.uid()
      ))
);

drop policy if exists "visit_time_entries_update" on public.visit_time_entries;
create policy "visit_time_entries_update"
on public.visit_time_entries for update
to authenticated
using (
  public.hs_can_manage_agency(agency_id)
  or (public.hs_is_staff_member(agency_id) and staff_member_id in (
        select sm.id from public.staff_members sm where sm.user_id = auth.uid()
      ))
)
with check (
  public.hs_can_manage_agency(agency_id)
  or (public.hs_is_staff_member(agency_id) and staff_member_id in (
        select sm.id from public.staff_members sm where sm.user_id = auth.uid()
      ))
);

drop policy if exists "visit_time_entries_delete" on public.visit_time_entries;
create policy "visit_time_entries_delete"
on public.visit_time_entries for delete
to authenticated
using (public.hs_is_agency_admin(agency_id));

-- -------------------------------------------------------------------
-- 14. visit_adjustment_history
-- Immutable log of edits to time entries
-- -------------------------------------------------------------------
create table if not exists public.visit_adjustment_history (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  visit_time_entry_id uuid not null references public.visit_time_entries(id) on delete cascade,
  changed_by_user_id uuid not null references public.user_profiles(id) on delete restrict,
  previous_clock_in_time timestamptz,
  previous_clock_out_time timestamptz,
  previous_adjusted_start_time timestamptz,
  previous_adjusted_end_time timestamptz,
  new_adjusted_start_time timestamptz,
  new_adjusted_end_time timestamptz,
  reason text,
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists idx_visit_adjustment_history_entry_id
  on public.visit_adjustment_history(visit_time_entry_id);

alter table public.visit_adjustment_history enable row level security;

drop policy if exists "visit_adjustment_history_select" on public.visit_adjustment_history;
create policy "visit_adjustment_history_select"
on public.visit_adjustment_history for select
to authenticated
using (public.hs_can_access_agency(agency_id));

drop policy if exists "visit_adjustment_history_insert" on public.visit_adjustment_history;
create policy "visit_adjustment_history_insert"
on public.visit_adjustment_history for insert
to authenticated
with check (public.hs_can_manage_agency(agency_id));

drop policy if exists "visit_adjustment_history_delete" on public.visit_adjustment_history;
create policy "visit_adjustment_history_delete"
on public.visit_adjustment_history for delete
to authenticated
using (false);

-- -------------------------------------------------------------------
-- 15. visit_approvals
-- -------------------------------------------------------------------
create table if not exists public.visit_approvals (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  scheduled_visit_id uuid not null references public.scheduled_visits(id) on delete cascade,
  visit_time_entry_id uuid not null unique references public.visit_time_entries(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  staff_member_id uuid not null references public.staff_members(id) on delete restrict,
  approved_by_user_id uuid not null references public.user_profiles(id) on delete restrict,
  approval_status text not null,
  approved_actual_hours numeric(10,2),
  approved_billable_hours numeric(10,2),
  approval_comment text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visit_approvals_status_check
    check (approval_status in ('approved','rejected','needs_update'))
);

create index if not exists idx_visit_approvals_agency_id on public.visit_approvals(agency_id);

drop trigger if exists trg_visit_approvals_updated_at on public.visit_approvals;
create trigger trg_visit_approvals_updated_at
before update on public.visit_approvals
for each row execute function public.set_updated_at();

alter table public.visit_approvals enable row level security;

drop policy if exists "visit_approvals_select" on public.visit_approvals;
create policy "visit_approvals_select"
on public.visit_approvals for select
to authenticated
using (public.hs_can_access_agency(agency_id));

drop policy if exists "visit_approvals_insert" on public.visit_approvals;
create policy "visit_approvals_insert"
on public.visit_approvals for insert
to authenticated
with check (public.hs_can_manage_agency(agency_id));

drop policy if exists "visit_approvals_update" on public.visit_approvals;
create policy "visit_approvals_update"
on public.visit_approvals for update
to authenticated
using (public.hs_can_manage_agency(agency_id))
with check (public.hs_can_manage_agency(agency_id));

drop policy if exists "visit_approvals_delete" on public.visit_approvals;
create policy "visit_approvals_delete"
on public.visit_approvals for delete
to authenticated
using (public.hs_is_agency_admin(agency_id));

-- -------------------------------------------------------------------
-- 16. pay_rate_schedule
-- -------------------------------------------------------------------
create table if not exists public.pay_rate_schedule (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  staff_member_id uuid references public.staff_members(id) on delete cascade,
  credential_id uuid references public.credential_catalog(id) on delete set null,
  task_id uuid references public.task_catalog(id) on delete set null,
  service_type text,
  rate numeric(10,2) not null,
  unit_type text not null default 'hour',
  effective_start date not null,
  effective_end date,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pay_rate_schedule_unit_type_check
    check (unit_type in ('hour','visit','15_min_unit'))
);

create index if not exists idx_pay_rate_schedule_agency_id on public.pay_rate_schedule(agency_id);

drop trigger if exists trg_pay_rate_schedule_updated_at on public.pay_rate_schedule;
create trigger trg_pay_rate_schedule_updated_at
before update on public.pay_rate_schedule
for each row execute function public.set_updated_at();

alter table public.pay_rate_schedule enable row level security;

drop policy if exists "pay_rate_schedule_select" on public.pay_rate_schedule;
create policy "pay_rate_schedule_select"
on public.pay_rate_schedule for select
to authenticated
using (public.hs_can_access_agency(agency_id));

drop policy if exists "pay_rate_schedule_insert" on public.pay_rate_schedule;
create policy "pay_rate_schedule_insert"
on public.pay_rate_schedule for insert
to authenticated
with check (public.hs_is_agency_admin(agency_id));

drop policy if exists "pay_rate_schedule_update" on public.pay_rate_schedule;
create policy "pay_rate_schedule_update"
on public.pay_rate_schedule for update
to authenticated
using (public.hs_is_agency_admin(agency_id))
with check (public.hs_is_agency_admin(agency_id));

drop policy if exists "pay_rate_schedule_delete" on public.pay_rate_schedule;
create policy "pay_rate_schedule_delete"
on public.pay_rate_schedule for delete
to authenticated
using (public.hs_is_agency_admin(agency_id));

-- -------------------------------------------------------------------
-- 17. visit_financials
-- Frozen payroll/billing results resolved at approval time
-- -------------------------------------------------------------------
create table if not exists public.visit_financials (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  scheduled_visit_id uuid not null unique references public.scheduled_visits(id) on delete cascade,
  visit_time_entry_id uuid not null unique references public.visit_time_entries(id) on delete cascade,
  visit_approval_id uuid references public.visit_approvals(id) on delete set null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  staff_member_id uuid not null references public.staff_members(id) on delete restrict,
  contract_id uuid references public.patient_service_contracts(id) on delete set null,
  billing_code_id uuid references public.billing_codes(id) on delete set null,
  pay_rate numeric(10,2) not null default 0,
  pay_unit_type text not null default 'hour',
  pay_amount numeric(10,2) not null default 0,
  bill_rate numeric(10,2) not null default 0,
  bill_unit_type text not null default 'hour',
  bill_amount numeric(10,2) not null default 0,
  approved_actual_hours numeric(10,2),
  approved_billable_hours numeric(10,2),
  calculation_basis jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visit_financials_pay_unit_type_check
    check (pay_unit_type in ('hour','visit','15_min_unit')),
  constraint visit_financials_bill_unit_type_check
    check (bill_unit_type in ('hour','visit','15_min_unit'))
);

create index if not exists idx_visit_financials_agency_id on public.visit_financials(agency_id);

drop trigger if exists trg_visit_financials_updated_at on public.visit_financials;
create trigger trg_visit_financials_updated_at
before update on public.visit_financials
for each row execute function public.set_updated_at();

alter table public.visit_financials enable row level security;

drop policy if exists "visit_financials_select" on public.visit_financials;
create policy "visit_financials_select"
on public.visit_financials for select
to authenticated
using (public.hs_can_access_agency(agency_id));

drop policy if exists "visit_financials_insert" on public.visit_financials;
create policy "visit_financials_insert"
on public.visit_financials for insert
to authenticated
with check (public.hs_can_manage_agency(agency_id));

drop policy if exists "visit_financials_update" on public.visit_financials;
create policy "visit_financials_update"
on public.visit_financials for update
to authenticated
using (public.hs_can_manage_agency(agency_id))
with check (public.hs_can_manage_agency(agency_id));

drop policy if exists "visit_financials_delete" on public.visit_financials;
create policy "visit_financials_delete"
on public.visit_financials for delete
to authenticated
using (public.hs_is_agency_admin(agency_id));

-- -------------------------------------------------------------------
-- 18. audit_log
-- Recommended central audit trail for sensitive changes
-- -------------------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references public.agencies(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  table_name text not null,
  record_id uuid,
  action text not null,
  performed_by_user_id uuid references public.user_profiles(id) on delete set null,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_agency_id on public.audit_log(agency_id);
create index if not exists idx_audit_log_patient_id on public.audit_log(patient_id);

alter table public.audit_log enable row level security;

drop policy if exists "audit_log_select" on public.audit_log;
create policy "audit_log_select"
on public.audit_log for select
to authenticated
using (agency_id is null or public.hs_can_manage_agency(agency_id));

drop policy if exists "audit_log_insert" on public.audit_log;
create policy "audit_log_insert"
on public.audit_log for insert
to authenticated
with check (agency_id is null or public.hs_can_manage_agency(agency_id));

drop policy if exists "audit_log_delete" on public.audit_log;
create policy "audit_log_delete"
on public.audit_log for delete
to authenticated
using (false);

-- -------------------------------------------------------------------
-- End of backbone schema
-- -------------------------------------------------------------------
