-- phast_two: Create caregiver_requirements table (patient_id, skill_codes array from CAREGIVER_SKILL_LISTS constant)
CREATE TABLE IF NOT EXISTS caregiver_requirements (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  skill_codes TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT caregiver_requirements_patient_key UNIQUE (patient_id)
);

CREATE INDEX IF NOT EXISTS idx_caregiver_requirements_patient_id ON caregiver_requirements(patient_id);

CREATE TRIGGER update_caregiver_requirements_updated_at
  BEFORE UPDATE ON caregiver_requirements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE caregiver_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view own caregiver_requirements"
  ON caregiver_requirements FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can insert own caregiver_requirements"
  ON caregiver_requirements FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can update own caregiver_requirements"
  ON caregiver_requirements FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

CREATE POLICY "Owners can delete own caregiver_requirements"
  ON caregiver_requirements FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM patients p WHERE p.id = patient_id AND p.owner_id = auth.uid())
  );

COMMENT ON TABLE caregiver_requirements IS 'Required caregiver skills per patient; skill_codes are names from CAREGIVER_SKILL_LISTS constant';
COMMENT ON COLUMN caregiver_requirements.skill_codes IS 'Array of skill names from CAREGIVER_SKILL_LISTS (src/lib/constants.ts)';
