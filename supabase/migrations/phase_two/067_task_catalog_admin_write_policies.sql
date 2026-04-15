-- Allow platform admins to maintain task categories and task catalog entries
-- from the admin Configuration page.

alter table public.task_categories enable row level security;

drop policy if exists "task_categories_admin_insert" on public.task_categories;
create policy "task_categories_admin_insert"
on public.task_categories for insert
to authenticated
with check (
  exists (
    select 1
    from public.user_profiles up
    where up.id = auth.uid()
      and up.role = 'admin'
  )
);

drop policy if exists "task_categories_admin_update" on public.task_categories;
create policy "task_categories_admin_update"
on public.task_categories for update
to authenticated
using (
  exists (
    select 1
    from public.user_profiles up
    where up.id = auth.uid()
      and up.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.user_profiles up
    where up.id = auth.uid()
      and up.role = 'admin'
  )
);

drop policy if exists "task_categories_admin_delete" on public.task_categories;
create policy "task_categories_admin_delete"
on public.task_categories for delete
to authenticated
using (
  exists (
    select 1
    from public.user_profiles up
    where up.id = auth.uid()
      and up.role = 'admin'
  )
);

drop policy if exists "task_catalog_admin_insert" on public.task_catalog;
create policy "task_catalog_admin_insert"
on public.task_catalog for insert
to authenticated
with check (
  exists (
    select 1
    from public.user_profiles up
    where up.id = auth.uid()
      and up.role = 'admin'
  )
);

drop policy if exists "task_catalog_admin_update" on public.task_catalog;
create policy "task_catalog_admin_update"
on public.task_catalog for update
to authenticated
using (
  exists (
    select 1
    from public.user_profiles up
    where up.id = auth.uid()
      and up.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.user_profiles up
    where up.id = auth.uid()
      and up.role = 'admin'
  )
);

drop policy if exists "task_catalog_admin_delete" on public.task_catalog;
create policy "task_catalog_admin_delete"
on public.task_catalog for delete
to authenticated
using (
  exists (
    select 1
    from public.user_profiles up
    where up.id = auth.uid()
      and up.role = 'admin'
  )
);
