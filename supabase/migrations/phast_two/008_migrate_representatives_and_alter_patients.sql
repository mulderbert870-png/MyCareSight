-- phast_two: Migrate representative data to patients_representatives, then alter patients

-- -- 1. Migrate representative_1 data
-- INSERT INTO patients_representatives (patient_id, name, relationship, phone_number, email_address, display_order)
-- SELECT id, representative_1_name, representative_1_relationship, representative_1_phone, NULL, 1
-- FROM patients
-- WHERE representative_1_name IS NOT NULL AND representative_1_name != '';

-- -- 2. Migrate representative_2 data
-- INSERT INTO patients_representatives (patient_id, name, relationship, phone_number, email_address, display_order)
-- SELECT id, representative_2_name, representative_2_relationship, representative_2_phone, NULL, 2
-- FROM patients
-- WHERE representative_2_name IS NOT NULL AND representative_2_name != '';

-- 3. Drop representative columns from patients
ALTER TABLE patients DROP COLUMN IF EXISTS representative_1_name;
ALTER TABLE patients DROP COLUMN IF EXISTS representative_1_relationship;
ALTER TABLE patients DROP COLUMN IF EXISTS representative_1_phone;
ALTER TABLE patients DROP COLUMN IF EXISTS representative_2_name;
ALTER TABLE patients DROP COLUMN IF EXISTS representative_2_relationship;
ALTER TABLE patients DROP COLUMN IF EXISTS representative_2_phone;

-- 4. Drop need_document and incident columns if they exist (plan: remove; todo: add them instead)
-- So we ADD need_document and incident columns per todo
ALTER TABLE patients ADD COLUMN IF NOT EXISTS documents jsonb DEFAULT '[]';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS incident_notes TEXT;


COMMENT ON COLUMN patients.documents IS 'Documents required for the patient';
COMMENT ON COLUMN patients.incident_notes IS 'Incident-related notes for the patient';
