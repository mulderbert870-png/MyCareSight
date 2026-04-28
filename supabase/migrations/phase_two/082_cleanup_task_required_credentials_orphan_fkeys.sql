-- Remove junction rows whose task_id or credential_id no longer exists in catalog tables.
-- Fixes ERROR 23503 on insert/update when FKs are enforced, e.g. after credential_catalog was
-- truncated/reseeded (new UUIDs) while task_required_credentials still held old ids.
--
-- To rebuild skill↔task links afterward, re-run the data section of migration 045 (or insert
-- rows again from your agency’s canonical catalog).

delete from public.task_required_credentials trc
where not exists (select 1 from public.credential_catalog cc where cc.id = trc.credential_id)
   or not exists (select 1 from public.task_catalog tc where tc.id = trc.task_id);
