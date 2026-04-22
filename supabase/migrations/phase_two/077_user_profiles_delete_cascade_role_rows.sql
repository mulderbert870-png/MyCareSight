-- Ensure role rows are removed when a user profile is deleted.
-- This covers tables that may not consistently enforce ON DELETE CASCADE
-- across all environments/migration histories.

CREATE OR REPLACE FUNCTION public.cleanup_role_rows_on_user_profile_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.caregiver_members
  WHERE user_id = OLD.id;

  DELETE FROM public.care_coordinators
  WHERE user_id = OLD.id;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_role_rows_on_user_profile_delete
ON public.user_profiles;

CREATE TRIGGER trg_cleanup_role_rows_on_user_profile_delete
AFTER DELETE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_role_rows_on_user_profile_delete();
