-- phast_two: Per-day ADL schedule (Mon-Sun) for each assigned ADL. Use patient_adls table for assigned ADLs.
ALTER TABLE patient_adls ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS patient_adl_day_schedule (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  adl_code TEXT NOT NULL,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week >= 1 AND day_of_week <= 7),
  schedule_type TEXT NOT NULL DEFAULT 'never' CHECK (schedule_type IN ('never', 'always', 'as_needed', 'specific_times')),
  times_per_day SMALLINT CHECK (times_per_day >= 1 AND times_per_day <= 4),
  slot_morning TEXT CHECK (slot_morning IS NULL OR slot_morning IN ('always', 'as_needed')),
  slot_afternoon TEXT CHECK (slot_afternoon IS NULL OR slot_afternoon IN ('always', 'as_needed')),
  slot_evening TEXT CHECK (slot_evening IS NULL OR slot_evening IN ('always', 'as_needed')),
  slot_night TEXT CHECK (slot_night IS NULL OR slot_night IN ('always', 'as_needed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT patient_adl_day_schedule_unique UNIQUE (patient_id, adl_code, day_of_week)
);

CREATE INDEX idx_patient_adl_day_schedule_patient ON patient_adl_day_schedule(patient_id);
CREATE INDEX idx_patient_adl_day_schedule_patient_adl ON patient_adl_day_schedule(patient_id, adl_code);

CREATE TRIGGER update_patient_adl_day_schedule_updated_at
  BEFORE UPDATE ON patient_adl_day_schedule
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE patient_adl_day_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view own patient_adl_day_schedule"
  ON patient_adl_day_schedule FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can insert own patient_adl_day_schedule"
  ON patient_adl_day_schedule FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can update own patient_adl_day_schedule"
  ON patient_adl_day_schedule FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can delete own patient_adl_day_schedule"
  ON patient_adl_day_schedule FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

COMMENT ON TABLE patient_adl_day_schedule IS 'Per-day (Mon=1..Sun=7) schedule for each patient ADL: never/always/as_needed/specific_times with optional time slots';
COMMENT ON COLUMN patient_adl_day_schedule.day_of_week IS '1=Monday, 7=Sunday';
COMMENT ON COLUMN patient_adl_day_schedule.times_per_day IS '1-4 when schedule_type is specific_times';
