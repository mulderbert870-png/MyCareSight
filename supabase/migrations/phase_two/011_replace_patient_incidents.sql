-- phast_two: Replace patient_incidents with new schema (incident_date, reporting_date, primary_contact, description, file)
DROP TABLE IF EXISTS patient_incidents;

CREATE TABLE patient_incidents (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  incident_date DATE NOT NULL,
  reporting_date DATE NOT NULL,
  primary_contact_person TEXT NOT NULL,
  description TEXT NOT NULL,
  file_path TEXT,
  file_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX idx_patient_incidents_patient_id ON patient_incidents(patient_id);
CREATE INDEX idx_patient_incidents_incident_date ON patient_incidents(incident_date DESC);
CREATE INDEX idx_patient_incidents_reporting_date ON patient_incidents(reporting_date DESC);

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

COMMENT ON TABLE patient_incidents IS 'Incident reports for a patient (file incident report with optional attachment)';
