-- Normalize task catalog: category + service_type live on task_categories;
-- task_catalog references task_categories via category_id.

-- -------------------------------------------------------------------
-- 1. task_categories
-- -------------------------------------------------------------------
create table if not exists public.task_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  service_type text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_categories_service_type_check
    check (service_type in ('non_skilled', 'skilled')),
  constraint task_categories_name_nonempty_check
    check (btrim(name) <> ''),
  constraint task_categories_name_service_unique unique (name, service_type)
);

drop trigger if exists trg_task_categories_updated_at on public.task_categories;
create trigger trg_task_categories_updated_at
before update on public.task_categories
for each row execute function public.set_updated_at();

alter table public.task_categories enable row level security;

drop policy if exists "task_categories_select" on public.task_categories;
create policy "task_categories_select"
on public.task_categories for select
to authenticated
using (true);

-- -------------------------------------------------------------------
-- 2. Backfill categories from existing task_catalog rows
-- -------------------------------------------------------------------
insert into public.task_categories (name, service_type, display_order)
select distinct
  coalesce(nullif(btrim(tc.category), ''), 'General') as name,
  tc.service_type,
  0
from public.task_catalog tc
on conflict (name, service_type) do nothing;

-- -------------------------------------------------------------------
-- 3. Link task_catalog rows
-- -------------------------------------------------------------------
alter table public.task_catalog
  add column if not exists category_id uuid references public.task_categories(id) on delete restrict;

update public.task_catalog t
set category_id = c.id
from public.task_categories c
where t.category_id is null
  and coalesce(nullif(btrim(t.category), ''), 'General') = c.name
  and t.service_type = c.service_type;

do $$
begin
  if exists (select 1 from public.task_catalog where category_id is null) then
    raise exception '047: task_catalog.category_id backfill incomplete (null category_id remains)';
  end if;
end $$;

alter table public.task_catalog alter column category_id set not null;

create index if not exists idx_task_catalog_category_id on public.task_catalog (category_id);

-- -------------------------------------------------------------------
-- 4. Drop legacy columns and check on task_catalog
-- -------------------------------------------------------------------
alter table public.task_catalog drop constraint if exists task_catalog_service_type_check;
alter table public.task_catalog drop column if exists category;
alter table public.task_catalog drop column if exists service_type;
