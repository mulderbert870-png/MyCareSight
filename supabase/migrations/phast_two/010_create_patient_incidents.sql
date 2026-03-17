-- phast_two: Create patient_incidents table for incident reports per client
CREATE TABLE IF NOT EXISTS patient_incidents (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  reported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
  description TEXT NOT NULL,
  incident_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_patient_incidents_patient_id ON patient_incidents(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_incidents_reported_at ON patient_incidents(reported_at DESC);

CREATE TRIGGER update_patient_incidents_updated_at
  BEFORE UPDATE ON patient_incidents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE patient_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view own patient incidents"
  ON patient_incidents FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can insert own patient incidents"
  ON patient_incidents FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can update own patient incidents"
  ON patient_incidents FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can delete own patient incidents"
  ON patient_incidents FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

COMMENT ON TABLE patient_incidents IS 'Incident reports for a patient/client';
