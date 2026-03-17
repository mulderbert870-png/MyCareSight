-- Add company details columns to agencies (for Profile company details form)
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS business_type TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS tax_id TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS primary_license_number TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS physical_street_address TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS physical_city TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS physical_state TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS physical_zip_code TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS same_as_physical BOOLEAN DEFAULT true;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS mailing_street_address TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS mailing_city TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS mailing_state TEXT;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS mailing_zip_code TEXT;

-- Company owners can view/update/insert their own agency (where agency_admin_id = their client id)
CREATE POLICY "Company owners can view own agency"
  ON agencies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = agencies.agency_admin_id
      AND c.company_owner_id = auth.uid()
    )
  );

CREATE POLICY "Company owners can insert own agency"
  ON agencies FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = agencies.agency_admin_id
      AND c.company_owner_id = auth.uid()
    )
  );

CREATE POLICY "Company owners can update own agency"
  ON agencies FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = agencies.agency_admin_id
      AND c.company_owner_id = auth.uid()
    )
  );

CREATE POLICY "Admins can insert agency company details"
  ON agencies FOR INSERT  
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin' OR
      EXISTS (
        SELECT 1 FROM clients c
        WHERE c.id = agencies.agency_admin_id
        AND c.company_owner_id = auth.uid()
      )
    )
  );
  CREATE POLICY "Admins can update agency company details"
  ON agencies FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin' OR
      EXISTS (
        SELECT 1 FROM clients c
        WHERE c.id = agencies.agency_admin_id
        AND c.company_owner_id = auth.uid()
      )
    )
  );
  CREATE POLICY "Admins can delete agency company details"
  ON agencies FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin' OR
      EXISTS (
        SELECT 1 FROM clients c
        WHERE c.id = agencies.agency_admin_id
        AND c.company_owner_id = auth.uid()
      )
    )
  );
  CREATE POLICY "Admins can view agency company details"
  ON agencies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin' OR
      EXISTS (
        SELECT 1 FROM clients c
        WHERE c.id = agencies.agency_admin_id
        AND c.company_owner_id = auth.uid()
      )
    )
  );