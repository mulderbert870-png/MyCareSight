-- phast_two: Add caregiver note per ADL (stored on each day row for easy retrieval).
ALTER TABLE patient_adl_day_schedule
ADD COLUMN IF NOT EXISTS adl_note TEXT;

COMMENT ON COLUMN patient_adl_day_schedule.adl_note IS
  'Optional caregiver-facing note for this ADL (displayed in visit ADL selection).';
