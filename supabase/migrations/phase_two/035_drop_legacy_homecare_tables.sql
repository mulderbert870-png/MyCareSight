-- Remove legacy tables after data was copied to HomeSight tables (032–034) and app uses new APIs.
-- schedules may already be dropped by 031; IF EXISTS keeps this idempotent.

DROP TABLE IF EXISTS public.schedules CASCADE;

DROP TABLE IF EXISTS public.caregiver_requirements CASCADE;
DROP TABLE IF EXISTS public.patient_contracted_hours CASCADE;
DROP TABLE IF EXISTS public.patient_adl_day_schedule CASCADE;
DROP TABLE IF EXISTS public.certifications CASCADE;
DROP TABLE IF EXISTS public.staff_licenses CASCADE;
DROP TABLE IF EXISTS public.clients CASCADE;
