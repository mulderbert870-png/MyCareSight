-- phast_two: Create adls table (patient-specific ADL assignments; adl_code references ADL_LISTS in constants)
CREATE TABLE IF NOT EXISTS adls (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  adl_code TEXT NOT NULL,
  frequency TEXT,
  specific_times TEXT[] DEFAULT '{}',
  times_per_day INTEGER,
  selected BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_adls_patient_id ON adls(patient_id);
CREATE INDEX IF NOT EXISTS idx_adls_adl_code ON adls(adl_code);

CREATE TRIGGER update_adls_updated_at
  BEFORE UPDATE ON adls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE adls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view own adls"
  ON adls FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can insert own adls"
  ON adls FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can update own adls"
  ON adls FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can delete own adls"
  ON adls FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

COMMENT ON TABLE adls IS 'Patient-specific ADL assignments with frequency and time slots';
COMMENT ON COLUMN adls.adl_code IS 'ADL name from ADL_LISTS constant (src/lib/constants.ts)';
