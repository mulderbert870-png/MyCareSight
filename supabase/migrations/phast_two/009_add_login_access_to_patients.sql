-- phast_two: Add login_access column to patients for portal login control
ALTER TABLE patients ADD COLUMN IF NOT EXISTS login_access BOOLEAN NOT NULL DEFAULT true;
COMMENT ON COLUMN patients.login_access IS 'Whether the patient has portal login access';

-- phast_two: Storage bucket for patient document uploads (patients.documents JSONB stores metadata)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'patient-documents',
  'patient-documents',
  true,
  52428800,
  NULL
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Authenticated users can read patient-documents" ON storage.objects;
CREATE POLICY "Authenticated users can read patient-documents"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'patient-documents');

DROP POLICY IF EXISTS "Authenticated users can upload patient-documents" ON storage.objects;
CREATE POLICY "Authenticated users can upload patient-documents"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'patient-documents');

DROP POLICY IF EXISTS "Authenticated users can delete patient-documents" ON storage.objects;
CREATE POLICY "Authenticated users can delete patient-documents"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'patient-documents');
