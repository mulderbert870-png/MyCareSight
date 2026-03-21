-- Caregiver/staff documents (metadata in JSONB, files in storage)
ALTER TABLE public.staff_members
  ADD COLUMN IF NOT EXISTS documents jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.staff_members.documents IS 'Uploaded caregiver documents: array of {id,name,path,url?,uploaded_at,size?}';

-- Storage bucket (same access pattern as patient-documents)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'staff-member-documents',
  'staff-member-documents',
  true,
  52428800,
  NULL
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Authenticated users can read staff-member-documents" ON storage.objects;
CREATE POLICY "Authenticated users can read staff-member-documents"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'staff-member-documents');

DROP POLICY IF EXISTS "Authenticated users can upload staff-member-documents" ON storage.objects;
CREATE POLICY "Authenticated users can upload staff-member-documents"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'staff-member-documents');

DROP POLICY IF EXISTS "Authenticated users can delete staff-member-documents" ON storage.objects;
CREATE POLICY "Authenticated users can delete staff-member-documents"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'staff-member-documents');
