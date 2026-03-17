-- Drop duplicate trigger: notify_admin_on_application_submission_trigger
-- Reason: Two triggers were creating admin notifications on new application insert:
--   1. notify_admins_new_application_trigger (status = 'requested', one per admin)
--   2. notify_admin_on_application_submission_trigger (every insert, one per admin)
-- This caused each admin to receive 2 (or more) notifications per new application.
-- Keeping only notify_admins_new_application_trigger so admins get one notification each.

DROP TRIGGER IF EXISTS notify_admin_on_application_submission_trigger ON applications;
