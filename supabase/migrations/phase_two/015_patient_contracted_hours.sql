-- phast_two: Contracted hours limit per period (effective_date to end_date), replaces per-week concept
CREATE TABLE IF NOT EXISTS patient_contracted_hours (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  total_hours NUMERIC(6,2) NOT NULL CHECK (total_hours >= 0),
  effective_date DATE NOT NULL,
  end_date DATE,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT patient_contracted_hours_end_after_effective CHECK (end_date IS NULL OR end_date >= effective_date)
);

CREATE INDEX idx_patient_contracted_hours_patient ON patient_contracted_hours(patient_id);
CREATE INDEX idx_patient_contracted_hours_dates ON patient_contracted_hours(patient_id, effective_date, end_date);

CREATE TRIGGER update_patient_contracted_hours_updated_at
  BEFORE UPDATE ON patient_contracted_hours
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE patient_contracted_hours ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view own patient_contracted_hours"
  ON patient_contracted_hours FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can insert own patient_contracted_hours"
  ON patient_contracted_hours FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can update own patient_contracted_hours"
  ON patient_contracted_hours FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can delete own patient_contracted_hours"
  ON patient_contracted_hours FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

COMMENT ON TABLE patient_contracted_hours IS 'Total contracted hours valid for period [effective_date, end_date]; scheduling must stay within total for overlapping periods';
