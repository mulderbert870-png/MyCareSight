DROP POLICY IF EXISTS "Admins can view all care coordinator rows" ON public.care_coordinators;
CREATE POLICY "Admins can view all care coordinator rows"
  ON public.care_coordinators FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role = 'admin'
    )
  );



--   user role CHECK
-- 1) Drop old role check (name may vary; inspect first if needed)
ALTER TABLE public.user_profiles
DROP CONSTRAINT IF EXISTS user_profiles_role_check;

-- 2) Recreate with care_coordinator included
ALTER TABLE public.user_profiles
ADD CONSTRAINT user_profiles_role_check
CHECK (role IN ('company_owner', 'staff_member', 'care_coordinator', 'admin', 'expert', 'super_admin'));