-- phast_two: Create patients_representatives table (reference image 8: Name, Relationship, Phone, Email)
CREATE TABLE IF NOT EXISTS patients_representatives (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name TEXT,
  relationship TEXT,
  phone_number TEXT,
  email_address TEXT,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_patients_representatives_patient_id ON patients_representatives(patient_id);

CREATE TRIGGER update_patients_representatives_updated_at
  BEFORE UPDATE ON patients_representatives
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE patients_representatives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view own patients representatives"
  ON patients_representatives FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can insert own patients representatives"
  ON patients_representatives FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can update own patients representatives"
  ON patients_representatives FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can delete own patients representatives"
  ON patients_representatives FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

COMMENT ON TABLE patients_representatives IS 'Patient representatives (e.g. family contacts); one or more per patient';
