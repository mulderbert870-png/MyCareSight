-- One agency can have several agency admins: change agency_admin_id to agency_admin_ids UUID[]
-- Step 1: Drop all RLS policies that depend on agency_admin_id (must be before dropping column)
DROP POLICY IF EXISTS "Company owners can view own agency" ON agencies;
DROP POLICY IF EXISTS "Company owners can insert own agency" ON agencies;
DROP POLICY IF EXISTS "Company owners can update own agency" ON agencies;
DROP POLICY IF EXISTS "Admins can insert agency company details" ON agencies;
DROP POLICY IF EXISTS "Admins can update agency company details" ON agencies;
DROP POLICY IF EXISTS "Admins can delete agency company details" ON agencies;
DROP POLICY IF EXISTS "Admins can view agency company details" ON agencies;

-- Step 2: Add new column
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS agency_admin_ids UUID[] DEFAULT '{}';

-- Step 3: Migrate existing data
UPDATE agencies
SET agency_admin_ids = CASE
  WHEN agency_admin_id IS NOT NULL THEN ARRAY[agency_admin_id]
  ELSE '{}'
END
WHERE agency_admin_ids = '{}' OR agency_admin_ids IS NULL;

-- Step 4: Drop old column and index
DROP INDEX IF EXISTS idx_agencies_agency_admin_id;
ALTER TABLE agencies DROP COLUMN IF EXISTS agency_admin_id;

-- Step 5: GIN index for array containment
CREATE INDEX IF NOT EXISTS idx_agencies_agency_admin_ids ON agencies USING GIN (agency_admin_ids);

-- Step 6: Recreate company-owner policies using agency_admin_ids
CREATE POLICY "Company owners can view own agency"
  ON agencies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.company_owner_id = auth.uid()
      AND c.id = ANY(agencies.agency_admin_ids)
    )
  );

CREATE POLICY "Company owners can insert own agency"
  ON agencies FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.company_owner_id = auth.uid()
      AND c.id = ANY(agencies.agency_admin_ids)
    )
  );

CREATE POLICY "Company owners can update own agency"
  ON agencies FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.company_owner_id = auth.uid()
      AND c.id = ANY(agencies.agency_admin_ids)
    )
  );

-- Step 7: Recreate "agency company details" policies using agency_admin_ids
CREATE POLICY "Admins can insert agency company details"
  ON agencies FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM clients c
      WHERE c.company_owner_id = auth.uid()
      AND c.id = ANY(agencies.agency_admin_ids)
    )
  );

CREATE POLICY "Admins can update agency company details"
  ON agencies FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM clients c
      WHERE c.company_owner_id = auth.uid()
      AND c.id = ANY(agencies.agency_admin_ids)
    )
  );

CREATE POLICY "Admins can delete agency company details"
  ON agencies FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM clients c
      WHERE c.company_owner_id = auth.uid()
      AND c.id = ANY(agencies.agency_admin_ids)
    )
  );

CREATE POLICY "Admins can view agency company details"
  ON agencies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM clients c
      WHERE c.company_owner_id = auth.uid()
      AND c.id = ANY(agencies.agency_admin_ids)
    )
  );
