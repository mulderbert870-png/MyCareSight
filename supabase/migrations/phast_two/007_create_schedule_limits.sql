-- phast_two: Create schedule_limits table (patient_id, date, limit_hour per patient per date)
CREATE TABLE IF NOT EXISTS schedule_limits (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  limit_hour NUMERIC(4,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT schedule_limits_patient_date_key UNIQUE (patient_id, date)
);

CREATE INDEX IF NOT EXISTS idx_schedule_limits_patient_id ON schedule_limits(patient_id);
CREATE INDEX IF NOT EXISTS idx_schedule_limits_date ON schedule_limits(date);

CREATE TRIGGER update_schedule_limits_updated_at
  BEFORE UPDATE ON schedule_limits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE schedule_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view own schedule_limits"
  ON schedule_limits FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can insert own schedule_limits"
  ON schedule_limits FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can update own schedule_limits"
  ON schedule_limits FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can delete own schedule_limits"
  ON schedule_limits FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

COMMENT ON TABLE schedule_limits IS 'Hour limit per patient per date for scheduling';
