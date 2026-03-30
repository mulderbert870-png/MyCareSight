-- staff_licenses + certifications → staff_credentials (preserve source in source_table/source_record_id).

INSERT INTO public.staff_credentials (
  agency_id,
  staff_member_id,
  user_id,
  credential_id,
  source_credential_name,
  credential_number,
  state,
  issue_date,
  expiration_date,
  issuing_authority,
  status,
  document_url,
  verified,
  source_table,
  source_record_id,
  created_at,
  updated_at
)
SELECT
  sm.agency_id,
  sl.staff_member_id,
  sm.user_id,
  NULL,
  sl.license_type,
  sl.license_number,
  sl.state,
  sl.issue_date,
  sl.expiry_date,
  NULL,
  sl.status,
  sl.document_url,
  false,
  'staff_licenses',
  sl.id,
  sl.created_at,
  sl.updated_at
FROM public.staff_licenses sl
INNER JOIN public.staff_members sm ON sm.id = sl.staff_member_id AND sm.agency_id IS NOT NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM public.staff_credentials x
  WHERE x.source_table = 'staff_licenses'
    AND x.source_record_id = sl.id
);

INSERT INTO public.staff_credentials (
  agency_id,
  staff_member_id,
  user_id,
  credential_id,
  source_credential_name,
  credential_number,
  state,
  issue_date,
  expiration_date,
  issuing_authority,
  status,
  document_url,
  verified,
  source_table,
  source_record_id,
  created_at,
  updated_at
)
SELECT
  sm.agency_id,
  sm.id,
  c.user_id,
  NULL,
  c.type,
  c.license_number,
  c.state,
  c.issue_date,
  c.expiration_date,
  c.issuing_authority,
  c.status,
  c.document_url,
  false,
  'certifications',
  c.id,
  c.created_at,
  c.updated_at
FROM public.certifications c
INNER JOIN public.staff_members sm ON sm.user_id = c.user_id AND sm.agency_id IS NOT NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM public.staff_credentials x
  WHERE x.source_table = 'certifications'
    AND x.source_record_id = c.id
);

-- Caregiver self-service (replaces phase_two/026 on staff_licenses).
DROP POLICY IF EXISTS "staff_credentials_insert_own_staff" ON public.staff_credentials;
CREATE POLICY "staff_credentials_insert_own_staff"
  ON public.staff_credentials FOR INSERT
  TO authenticated
  WITH CHECK (
    public.hs_can_manage_agency(agency_id)
    OR EXISTS (
      SELECT 1
      FROM public.staff_members sm
      WHERE sm.id = staff_credentials.staff_member_id
        AND sm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "staff_credentials_update_own_staff" ON public.staff_credentials;
CREATE POLICY "staff_credentials_update_own_staff"
  ON public.staff_credentials FOR UPDATE
  TO authenticated
  USING (
    public.hs_can_manage_agency(agency_id)
    OR EXISTS (
      SELECT 1
      FROM public.staff_members sm
      WHERE sm.id = staff_credentials.staff_member_id
        AND sm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.hs_can_manage_agency(agency_id)
    OR EXISTS (
      SELECT 1
      FROM public.staff_members sm
      WHERE sm.id = staff_credentials.staff_member_id
        AND sm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "staff_credentials_delete_own_staff" ON public.staff_credentials;
CREATE POLICY "staff_credentials_delete_own_staff"
  ON public.staff_credentials FOR DELETE
  TO authenticated
  USING (
    public.hs_is_agency_admin(agency_id)
    OR EXISTS (
      SELECT 1
      FROM public.staff_members sm
      WHERE sm.id = staff_credentials.staff_member_id
        AND sm.user_id = auth.uid()
    )
  );
