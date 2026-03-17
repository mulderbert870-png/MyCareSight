-- Run this in Supabase SQL Editor to fix: when admin approves a requested application,
-- all main (non-expert) steps from the license requirement are added to application_steps.
-- Previously the trigger was disabled, so only expert steps (added at creation) appeared.

DROP TRIGGER IF EXISTS initialize_application_steps_on_approval_trigger ON applications;
DROP FUNCTION IF EXISTS public.initialize_application_steps() CASCADE;
DROP FUNCTION IF EXISTS public.initialize_application_steps_on_approval() CASCADE;

CREATE OR REPLACE FUNCTION initialize_application_steps_on_approval()
RETURNS TRIGGER AS $$
DECLARE
  license_type_name TEXT;
  license_requirement_uuid UUID;
  step_record RECORD;
  next_step_order INTEGER;
BEGIN
  IF NEW.status = 'in_progress' AND OLD.status = 'requested' AND NEW.license_type_id IS NOT NULL THEN
    SELECT name INTO license_type_name
    FROM license_types
    WHERE id = NEW.license_type_id;

    IF license_type_name IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT id INTO license_requirement_uuid
    FROM license_requirements
    WHERE state = NEW.state 
      AND license_type = license_type_name
    LIMIT 1;

    IF license_requirement_uuid IS NOT NULL THEN
      SELECT COALESCE(MAX(step_order), 0) + 1 INTO next_step_order
      FROM application_steps
      WHERE application_id = NEW.id;

      FOR step_record IN
        SELECT step_name, step_order, instructions
        FROM license_requirement_steps
        WHERE license_requirement_id = license_requirement_uuid
          AND COALESCE(is_expert_step, false) = false
        ORDER BY step_order
      LOOP
        INSERT INTO application_steps (application_id, step_name, step_order, instructions, is_completed)
        VALUES (NEW.id, step_record.step_name, next_step_order, step_record.instructions, FALSE);
        next_step_order := next_step_order + 1;
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER initialize_application_steps_on_approval_trigger
  AFTER UPDATE ON applications
  FOR EACH ROW
  EXECUTE FUNCTION initialize_application_steps_on_approval();
