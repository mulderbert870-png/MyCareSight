-- Rename small_clients table to patients

ALTER TABLE small_clients RENAME TO patients;

-- Rename indexes
ALTER INDEX IF EXISTS idx_small_clients_owner RENAME TO idx_patients_owner;
ALTER INDEX IF EXISTS idx_small_clients_status RENAME TO idx_patients_status;
ALTER INDEX IF EXISTS idx_small_clients_name RENAME TO idx_patients_name;
ALTER INDEX IF EXISTS idx_small_clients_email RENAME TO idx_patients_email;
ALTER INDEX IF EXISTS idx_small_clients_phone RENAME TO idx_patients_phone;

-- Drop triggers (they reference the table, now named patients)
DROP TRIGGER IF EXISTS update_small_clients_updated_at ON patients;
DROP TRIGGER IF EXISTS update_small_clients_age ON patients;

-- Recreate triggers on patients
CREATE TRIGGER update_patients_updated_at
  BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_patients_age
  BEFORE INSERT OR UPDATE ON patients
  FOR EACH ROW
  EXECUTE FUNCTION update_client_age();

-- Update comments
COMMENT ON TABLE patients IS 'Care recipients/patients managed by company owners (formerly small_clients)';
COMMENT ON COLUMN patients.owner_id IS 'References auth.users(id) - the company owner who manages this patient';
