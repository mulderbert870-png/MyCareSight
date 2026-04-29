-- Drop no-longer-used legacy lookup/mapping tables.
-- Runtime code has been updated to stop querying these tables.

DROP TABLE IF EXISTS public.task_billing_map;
DROP TABLE IF EXISTS public.issuing_authorities;
DROP TABLE IF EXISTS public.expert_states;
DROP TABLE IF EXISTS public.client_states;
