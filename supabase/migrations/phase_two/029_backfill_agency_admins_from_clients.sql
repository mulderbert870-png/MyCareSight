-- One row in agency_admins per legacy clients row that has an agency_id.
-- Preserves clients.id as agency_admins.id for stable 1:1 mapping during pivot.
-- Idempotent: ON CONFLICT DO NOTHING.

INSERT INTO public.agency_admins (
  id,
  user_id,
  agency_id,
  expert_id,
  company_owner_id,
  company_name,
  contact_name,
  contact_email,
  contact_phone,
  status,
  start_date,
  business_type,
  tax_id,
  primary_license_number,
  website,
  physical_street_address,
  physical_city,
  physical_state,
  physical_zip_code,
  mailing_street_address,
  mailing_city,
  mailing_state,
  mailing_zip_code,
  created_at,
  updated_at
)
SELECT
  c.id,
  c.company_owner_id,
  c.agency_id,
  le.id,
  c.company_owner_id,
  c.company_name,
  c.contact_name,
  c.contact_email,
  c.contact_phone,
  c.status,
  c.start_date,
  COALESCE(c.business_type, a.business_type),
  COALESCE(c.tax_id, a.tax_id),
  COALESCE(c.primary_license_number, a.primary_license_number),
  COALESCE(c.website, a.website),
  COALESCE(c.physical_street_address, a.physical_street_address),
  COALESCE(c.physical_city, a.physical_city),
  COALESCE(c.physical_state, a.physical_state),
  COALESCE(c.physical_zip_code, a.physical_zip_code),
  COALESCE(c.mailing_street_address, a.mailing_street_address),
  COALESCE(c.mailing_city, a.mailing_city),
  COALESCE(c.mailing_state, a.mailing_state),
  COALESCE(c.mailing_zip_code, a.mailing_zip_code),
  c.created_at,
  c.updated_at
FROM public.clients c
LEFT JOIN public.agencies a ON a.id = c.agency_id
LEFT JOIN public.licensing_experts le ON le.user_id = c.expert_id
WHERE c.agency_id IS NOT NULL
  AND c.company_owner_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.user_profiles up WHERE up.id = c.company_owner_id
  )
ON CONFLICT (id) DO NOTHING;
