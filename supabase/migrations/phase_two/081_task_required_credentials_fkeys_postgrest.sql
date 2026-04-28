-- PostgREST PGRST200: getCaregiverSkillCatalogFromTaskRequirements embeds
--   credential_catalog:credential_id (...) and task_catalog:task_id (...)
-- Those hints require real FK constraints on public.task_required_credentials.
-- If the table pre-existed without them (CREATE TABLE IF NOT EXISTS), add them here.
--
-- If ADD CONSTRAINT fails, find orphans:
--   select * from public.task_required_credentials trc
--     left join public.credential_catalog cc on cc.id = trc.credential_id where cc.id is null;
--   select * from public.task_required_credentials trc
--     left join public.task_catalog tc on tc.id = trc.task_id where tc.id is null;

alter table public.task_required_credentials
  drop constraint if exists task_required_credentials_task_id_fkey;

alter table public.task_required_credentials
  add constraint task_required_credentials_task_id_fkey
  foreign key (task_id)
  references public.task_catalog(id)
  on delete cascade;

alter table public.task_required_credentials
  drop constraint if exists task_required_credentials_credential_id_fkey;

alter table public.task_required_credentials
  add constraint task_required_credentials_credential_id_fkey
  foreign key (credential_id)
  references public.credential_catalog(id)
  on delete cascade;

create index if not exists idx_task_required_credentials_credential_id
  on public.task_required_credentials (credential_id);
