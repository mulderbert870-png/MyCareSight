-- phast_two: Create schedules table (visits: patient, caregiver, date/times, adl_codes; repeat_frequency, days_of_week, repeat_start, repeat_end)
CREATE TABLE IF NOT EXISTS schedules (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  caregiver_id UUID REFERENCES staff_members(id) ON DELETE SET NULL,
  adl_codes TEXT[] DEFAULT '{}',
  date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  description TEXT,
  type TEXT,
  notes TEXT,
  is_recurring BOOLEAN DEFAULT false,
  repeat_frequency TEXT,
  days_of_week INTEGER[] DEFAULT '{}',
  repeat_start DATE,
  repeat_end DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schedules_patient_id ON schedules(patient_id);
CREATE INDEX IF NOT EXISTS idx_schedules_caregiver_id ON schedules(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(date);
CREATE INDEX IF NOT EXISTS idx_schedules_patient_date ON schedules(patient_id, date);

CREATE TRIGGER update_schedules_updated_at
  BEFORE UPDATE ON schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view own schedules"
  ON schedules FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can insert own schedules"
  ON schedules FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can update own schedules"
  ON schedules FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can delete own schedules"
  ON schedules FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

COMMENT ON TABLE schedules IS 'Care visits: patient, caregiver, date/time, ADL tasks; supports recurring with repeat_frequency, days_of_week, repeat_start, repeat_end';
COMMENT ON COLUMN schedules.adl_codes IS 'Array of ADL names from ADL_LISTS constant (src/lib/constants.ts) for this visit';
COMMENT ON COLUMN schedules.days_of_week IS '0=Sunday..6=Saturday for recurring';
