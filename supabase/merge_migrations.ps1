# Merge all migrations into one production SQL file in correct dependency order.
# Handles: 002 split (application_steps after applications), 077/078/079 placement,
# applications.assigned_expert_id & license_type_id, 003 trim, 036 no-insert, 037 policy-only, 066 category.

$migrationsDir = Join-Path $PSScriptRoot "migrations"
$outPath = Join-Path (Split-Path $migrationsDir -Parent) "production_full_schema.sql"
$encoding = [System.Text.Encoding]::UTF8

# Order: 001, 002 part1, 079, 002 part2, 003 (no alter), 004-018, 077, [applications columns], 020-035, 078, 036 (no insert), 036_sample, 037 (policy only), 038-066a, 066_templates (with category), 067a, 067b, 068a, 068b, 069-076, RLS_fixed, 026, 027, 047
$script:content = @()
$script:content += @"
-- =============================================================================
-- HomeCareLicensing Production - Full Schema (merged from all migrations)
-- Run this on a fresh production database. Original migration files are unchanged.
-- =============================================================================

"@

function AddFile($name) {
    $path = Join-Path $migrationsDir $name
    if (Test-Path $path) {
        $script:content += "`n-- ========== $name ==========`n"
        $script:content += (Get-Content $path -Raw)
    }
}

function AddFileExcept($name, $excludePattern) {
    $path = Join-Path $migrationsDir $name
    if (Test-Path $path) {
        $text = Get-Content $path -Raw
        $text = $text -replace $excludePattern, ""
        $script:content += "`n-- ========== $name (trimmed) ==========`n"
        $script:content += $text
    }
}

function AddFileUntil($name, $untilLine) {
    $path = Join-Path $migrationsDir $name
    if (Test-Path $path) {
        $lines = Get-Content $path
        $part1 = $lines[0..($untilLine-1)] -join "`n"
        $script:content += "`n-- ========== $name (part 1) ==========`n"
        $script:content += $part1
    }
}

function AddFileFrom($name, $fromLine) {
    $path = Join-Path $migrationsDir $name
    if (Test-Path $path) {
        $lines = Get-Content $path
        $part2 = $lines[($fromLine)..($lines.Length-1)] -join "`n"
        $script:content += "`n-- ========== $name (part 2) ==========`n"
        $script:content += $part2
    }
}

# 001
AddFile "001_initial_schema.sql"

# 002 part 1 (through line 48: idx_applications_status)
$path002 = Join-Path $migrationsDir "002_dashboard_schema.sql"
$lines002 = Get-Content $path002
$part1 = $lines002[0..47] -join "`n"
$script:content += "`n-- ========== 002_dashboard_schema.sql (part 1: through applications) ==========`n"
$script:content += $part1

# 079 application_steps (must exist before 002's alter)
AddFile "079_application_steps_schema.sql"

# assigned_expert_id must exist before 002 part 2 (RLS policies reference it)
$script:content += "`n-- ========== applications.assigned_expert_id (required by 002 part 2 RLS) ==========`n"
$script:content += @"
ALTER TABLE applications ADD COLUMN IF NOT EXISTS assigned_expert_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_applications_assigned_expert ON applications(assigned_expert_id) WHERE assigned_expert_id IS NOT NULL;
"@

# 002 part 2 (from alter application_steps); fix duplicate instructions ADD COLUMN to use IF NOT EXISTS (079 already has it)
$part2 = $lines002[49..($lines002.Length-1)] -join "`n"
$part2 = $part2 -replace "ALTER TABLE application_steps\s+ADD COLUMN instructions text", "ALTER TABLE application_steps ADD COLUMN IF NOT EXISTS instructions text"
$script:content += "`n-- ========== 002_dashboard_schema.sql (part 2: application_steps alter and rest) ==========`n"
$script:content += $part2

# 003 without the alter license_requirement_templates at the end
$path003 = Join-Path $migrationsDir "003_admin_dashboard_schema.sql"
$text003 = Get-Content $path003 -Raw
$text003 = $text003 -replace "(?s)-- add category column to license_requirement_templates\s+alter table license_requirement_templates\s+add column category text\s*$", ""
$script:content += "`n-- ========== 003_admin_dashboard_schema.sql (category moved to 066) ==========`n"
$script:content += $text003

# 004-018
foreach ($f in @("004_staff_dashboard_rls.sql","005_expert_dashboard_rls.sql","006_demo_accounts.sql","007_fix_user_profiles_rls_recursion.sql","008_create_demo_staff_member.sql","009_auto_create_staff_member.sql","010_insert_client_relations.sql","014_create_expert_function.sql","015_update_user_password_function.sql","016_create_pricing_table.sql","017_change_staff_members_to_clients_relation.sql","018_drop_billing_table.sql")) {
    AddFile $f
}

# 077 license_types (before 020)
AddFile "077_license_types_schema.sql"

# license_type_id (FK to license_types; assigned_expert_id already added after 079)
$script:content += "`n-- ========== applications.license_type_id (FK to license_types) ==========`n"
$script:content += @"
ALTER TABLE applications ADD COLUMN IF NOT EXISTS license_type_id UUID REFERENCES license_types(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_applications_license_type ON applications(license_type_id) WHERE license_type_id IS NOT NULL;
"@

# 020-035 (conversations created in 003 lack admin_id; add it before 025 so 025's policies/index work)
$script:content += "`n-- ========== conversations.admin_id (003 creates table without it; 025 needs it) ==========`n"
$script:content += @"
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_admin ON conversations(admin_id);
"@

# 020-035 (025: drop trigger before create so idempotent when 003 already created it)
foreach ($f in @("020_add_service_fee_to_license_types.sql","021_add_client_messages_rls.sql","022_add_client_rls_for_company_owners.sql")) {
    AddFile $f
}
$path025 = Join-Path $migrationsDir "025_restore_conversations_table.sql"
$text025 = Get-Content $path025 -Raw
$text025 = $text025 -replace "-- Add trigger for updated_at\s+CREATE TRIGGER update_conversations_updated_at ", "-- Add trigger for updated_at (drop first; 003 may have already created it)`nDROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;`nCREATE TRIGGER update_conversations_updated_at "
$text025 = $text025 -replace "(\$\$ LANGUAGE plpgsql;\s+)CREATE TRIGGER update_conversation_last_message_trigger\s+AFTER INSERT ON messages", '$1DROP TRIGGER IF EXISTS update_conversation_last_message_trigger ON messages;
CREATE TRIGGER update_conversation_last_message_trigger
  AFTER INSERT ON messages'
$text025 = $text025 -replace "-- RLS Policies for conversations \(admins can view and manage their own conversations\)\s+CREATE POLICY ""Admins can view own conversations""", @"
-- Drop 025 conversation policies if they exist (005/003 may have created some; make idempotent)
DROP POLICY IF EXISTS "Admins can view own conversations" ON conversations;
DROP POLICY IF EXISTS "Admins can manage own conversations" ON conversations;
DROP POLICY IF EXISTS "Experts can view own conversations" ON conversations;
DROP POLICY IF EXISTS "Experts can create conversations" ON conversations;
DROP POLICY IF EXISTS "Experts can update own conversations" ON conversations;
DROP POLICY IF EXISTS "Clients can view own conversations" ON conversations;
DROP POLICY IF EXISTS "Clients can create conversations" ON conversations;
DROP POLICY IF EXISTS "Clients can update own conversations" ON conversations;

-- RLS Policies for conversations (admins can view and manage their own conversations)
CREATE POLICY "Admins can view own conversations"
"@
$script:content += "`n-- ========== 025_restore_conversations_table.sql ==========`n"
$script:content += $text025
foreach ($f in @("029_drop_conversations_and_messages_tables.sql","030_create_1to1_messaging_system.sql","031_insert_sample_conversations_and_messages.sql","032_add_pricing_rls_policies.sql","033_fix_handle_new_user_for_staff_members.sql","034_fix_staff_members_policy.sql","035_modify_applications_for_staff_licenses.sql")) {
    AddFile $f
}

# 078 certification_types (before 036 which inserts into it)
AddFile "078_certification_types_schema.sql"

# 036_add_certifications without INSERT INTO certification_types (already seeded in 078)
$path036 = Join-Path $migrationsDir "036_add_certifications.sql"
$text036 = Get-Content $path036 -Raw
$text036 = $text036 -replace "(?s)-- Insert 7 records into certification_types table\s+INSERT INTO certification_types \(certification_type\) VALUES[\s\S]*?;\s*$", "-- Certification types seeded in 078_certification_types_schema.sql"
$script:content += "`n-- ========== 036_add_certifications.sql (no cert types insert) ==========`n"
$script:content += $text036

AddFile "036_add_sample_staff_licenses.sql"

# 037: only RLS policy (table and seed from 078); drop first so idempotent (078 already creates it)
$path037 = Join-Path $migrationsDir "037_certification_types_schema.sql"
$text037 = Get-Content $path037 -Raw
$text037 = $text037 -replace "(?s)-- Create certification_types table\s+CREATE TABLE certification_types[\s\S]*?;\s*-- Insert 7 records[\s\S]*?;\s*", ""
$text037 = $text037 -replace "CREATE POLICY ""Allow staff to read certification types""", "DROP POLICY IF EXISTS ""Allow staff to read certification types"" ON certification_types;`nCREATE POLICY ""Allow staff to read certification types"""
$script:content += "`n-- ========== 037_certification_types_schema.sql (policy only, table in 078) ==========`n"
$script:content += $text037

# 038-066_add_expert (043: drop notifications policies first; 002 may have already created them)
foreach ($f in @("038_add_pricing_history.sql","039_create_system_lists_tables.sql","041_allow_clients_read_assigned_expert.sql","042_convert_to_application_group_chat.sql")) {
    AddFile $f
}
$path043 = Join-Path $migrationsDir "043_notifications_table.sql"
$text043 = Get-Content $path043 -Raw
$text043 = $text043 -replace "-- RLS Policies for notifications\s+CREATE POLICY ""Users can view own notifications""", @"
-- Drop 043 notifications policies if they exist (002 may have already created them; make idempotent)
DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can insert own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can delete own notifications" ON notifications;

-- RLS Policies for notifications
CREATE POLICY "Users can view own notifications"
"@
$script:content += "`n-- ========== 043_notifications_table.sql ==========`n"
$script:content += $text043
foreach ($f in @("044_optimize_message_notifications.sql","045_change_is_read_to_uuid_array.sql","046_trigger_notification.sql","047.restore_notification_query.sql","048_fix_rpc_functions_with_error_handling.sql","049_mark_notifications_read_when_message_read.sql","050_remove_message_and_icon_type_from_notifications.sql","052_add_expert_steps_to_applications.sql","053_add_expiry_date_to_license_documents.sql","054_add_company_details_fields_to_clients.sql","055_add_personal_info_fields_to_user_profiles.sql","056_create_small_clients_table.sql","057_fix_create_message_notifications_function.sql","058_add_notifications_message_icon_type_back.sql","059_add_estimated_days_to_license_requirement_steps.sql","060_add_is_required_to_license_requirement_steps.sql","061_notify_admins_on_new_application.sql","062_notify_expert_when_assigned.sql","063_notify_expert_on_document_upload.sql","064_notify_owner_on_document_approved.sql","065_notify_owner_on_application_approved.sql","066_add_expert_step_and_phase_to_license_requirement_steps.sql")) {
    AddFile $f
}

# 066_license_requirement_templates with category in CREATE
$path066t = Join-Path $migrationsDir "066_license_requirement_templates.sql"
$text066t = Get-Content $path066t -Raw
$text066t = $text066t -replace "template_name TEXT NOT NULL,", "template_name TEXT NOT NULL,`n  category TEXT,"
$script:content += "`n-- ========== 066_license_requirement_templates.sql (with category) ==========`n"
$script:content += $text066t

# 067, 068, 069-076 (080: application-documents storage bucket)
foreach ($f in @("067_add_license_requirement_document_id_to_application_documents.sql","067_storage_bucket_license_templates.sql","068_allow_read_license_requirement_tables_for_owners_experts.sql","068_storage_policies_license_templates.sql","080_storage_bucket_application_documents.sql","069_add_phase_to_application_steps.sql","070_document_status_draft_and_submit_flow.sql","071_applications_status_allow_closed.sql","072_enable_realtime_messages_notifications.sql","073_application_steps_rls_company_owners.sql","074_allow_read_license_requirement_templates.sql","075_initialize_application_steps.sql","076_recalculate_application_progress_steps_documents_only.sql")) {
    AddFile $f
}

AddFile "RLS_fixed.sql"

# Optional restores (026, 027 - small)
foreach ($f in @("026_restore_messages_rls_to_original.sql","027_restore_messages_rls_to_original.sql")) {
    if (Test-Path (Join-Path $migrationsDir $f)) { AddFile $f }
}

$fullText = $script:content -join ""
[System.IO.File]::WriteAllText($outPath, $fullText, $encoding)
Write-Host "Written: $outPath"
