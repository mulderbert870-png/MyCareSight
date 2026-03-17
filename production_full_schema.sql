-- =============================================================================
-- HomeCareLicensing Production - Full Schema (merged from all migrations)
-- Run this on a fresh production database. Original migration files are unchanged.
-- =============================================================================


-- ========== 002_dashboard_schema.sql (part 1: through applications) ==========


-- ========== 002_dashboard_schema.sql (part 2: application_steps alter and rest) ==========


-- ========== 003_admin_dashboard_schema.sql (category moved to 066) ==========


-- ========== applications columns (assigned_expert_id, license_type_id) ==========

ALTER TABLE applications ADD COLUMN IF NOT EXISTS assigned_expert_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS license_type_id UUID REFERENCES license_types(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_applications_assigned_expert ON applications(assigned_expert_id) WHERE assigned_expert_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_applications_license_type ON applications(license_type_id) WHERE license_type_id IS NOT NULL;

-- ========== 036_add_certifications.sql (no cert types insert) ==========


-- ========== 037_certification_types_schema.sql (policy only, table in 078) ==========


-- ========== 066_license_requirement_templates.sql (with category) ==========

