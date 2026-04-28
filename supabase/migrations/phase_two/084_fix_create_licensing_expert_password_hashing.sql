-- Fix create_licensing_expert password hashing on Supabase.
-- In Supabase, crypt/gen_salt are provided in the "extensions" schema.
-- The previous implementation relied on pgcrypto in search_path and could fail with:
--   function gen_salt(unknown, integer) does not exist

CREATE OR REPLACE FUNCTION public.create_licensing_expert(
  p_first_name TEXT,
  p_last_name TEXT,
  p_email TEXT,
  p_password TEXT,
  p_phone TEXT DEFAULT NULL,
  p_expertise TEXT DEFAULT NULL,
  p_role TEXT DEFAULT 'Licensing Specialist',
  p_status TEXT DEFAULT 'active'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_expert_id UUID;
  v_instance_uuid UUID;
  v_now_ts TIMESTAMPTZ;
  v_encrypted_pw TEXT;
BEGIN
  v_now_ts := NOW();

  SELECT COALESCE(
    (SELECT instance_id FROM auth.users LIMIT 1),
    (SELECT id FROM auth.instances LIMIT 1),
    '00000000-0000-0000-0000-000000000000'::uuid
  ) INTO v_instance_uuid;

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = LOWER(TRIM(p_email))
  LIMIT 1;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    -- Use fully-qualified extension functions for compatibility on Supabase.
    v_encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf'));

    -- Keep insert to a minimal, portable set of auth.users columns.
    -- Newer Supabase auth schemas reject explicit writes to some legacy/internal columns
    -- (e.g. confirmed_at), so we let defaults handle them.
    INSERT INTO auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      phone
    ) VALUES (
      v_user_id,
      v_instance_uuid,
      'authenticated',
      'authenticated',
      LOWER(TRIM(p_email)),
      v_encrypted_pw,
      v_now_ts,
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', p_first_name || ' ' || p_last_name, 'role', 'expert'),
      v_now_ts,
      v_now_ts,
      p_phone
    );

    INSERT INTO public.user_profiles (id, email, full_name, role)
    VALUES (v_user_id, LOWER(TRIM(p_email)), p_first_name || ' ' || p_last_name, 'expert')
    ON CONFLICT (id) DO UPDATE
    SET
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      email = EXCLUDED.email,
      updated_at = v_now_ts;
  END IF;

  INSERT INTO public.licensing_experts (user_id, first_name, last_name, email, phone, status, expertise, role)
  VALUES (
    v_user_id,
    p_first_name,
    p_last_name,
    LOWER(TRIM(p_email)),
    p_phone,
    p_status,
    p_expertise,
    p_role
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    status = EXCLUDED.status,
    expertise = EXCLUDED.expertise,
    role = EXCLUDED.role,
    updated_at = v_now_ts
  RETURNING id INTO v_expert_id;

  RETURN v_expert_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to create licensing expert: %', SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_licensing_expert(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
