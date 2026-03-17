-- Drop duplicate trigger: notify_expert_on_assignment_update_trigger
-- Reason: Two triggers created expert notifications when admin assigns an expert (UPDATE assigned_expert_id):
--   1. notify_expert_when_assigned_trigger (062) -> "Application Assigned to You"
--   2. notify_expert_on_assignment_update_trigger -> "New Application Assigned"
-- Experts were receiving two notifications. Keeping only notify_expert_when_assigned_trigger.

DROP TRIGGER IF EXISTS notify_expert_on_assignment_update_trigger ON applications;
