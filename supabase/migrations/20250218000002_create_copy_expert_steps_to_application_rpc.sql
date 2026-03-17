-- RPC called from client when company owner submits new license request (Review License Application Request).
-- Creates application_steps from license_requirement_steps (expert steps) for the new application.

CREATE OR REPLACE FUNCTION copy_expert_steps_to_application(
  p_application_id UUID,
  p_state TEXT,
  p_license_type_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requirement_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM application_steps
    WHERE application_id = p_application_id AND is_expert_step = true
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  SELECT id INTO v_requirement_id
  FROM license_requirements
  WHERE state = p_state AND license_type = p_license_type_name
  LIMIT 1;

  IF v_requirement_id IS NULL THEN
    INSERT INTO license_requirements (state, license_type)
    VALUES (p_state, p_license_type_name)
    RETURNING id INTO v_requirement_id;
  END IF;

  INSERT INTO application_steps (
    application_id,
    step_name,
    step_order,
    description,
    instructions,
    phase,
    is_expert_step,
    is_completed
  )
  SELECT
    p_application_id,
    step_name,
    step_order,
    description,
    instructions,
    phase,
    true,
    false
  FROM license_requirement_steps
  WHERE license_requirement_id = v_requirement_id
    AND COALESCE(is_expert_step, false) = true
  ORDER BY step_order;
END;
$$;

COMMENT ON FUNCTION copy_expert_steps_to_application(UUID, TEXT, TEXT) IS
  'Copies expert step templates to application_steps. Called from client after creating an application.';
