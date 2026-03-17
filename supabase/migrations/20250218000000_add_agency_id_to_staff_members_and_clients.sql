-- Add agency_id to clients and staff_members so that:
-- 1) When an agency admin is assigned to an agency, their client record has agency_id set.
-- 2) When an agency admin adds a caregiver, the staff_member is assigned to the same agency.

-- clients.agency_id: which agency this client (agency admin) is assigned to
ALTER TABLE clients
ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_agency_id ON clients(agency_id);

-- staff_members.agency_id: which agency this caregiver belongs to (set when added by agency admin)
ALTER TABLE staff_members
ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_staff_members_agency_id ON staff_members(agency_id);

-- Backfill: set clients.agency_id for existing agency admins from agencies.agency_admin_ids
UPDATE clients c
SET agency_id = a.id
FROM agencies a
WHERE a.agency_admin_ids IS NOT NULL
  AND c.id = ANY(a.agency_admin_ids)
  AND (c.agency_id IS NULL OR c.agency_id != a.id);

-- Backfill: set staff_members.agency_id from their client's agency_id
UPDATE staff_members sm
SET agency_id = c.agency_id
FROM clients c
WHERE c.id = sm.company_owner_id
  AND c.agency_id IS NOT NULL
  AND (sm.agency_id IS NULL OR sm.agency_id != c.agency_id);
