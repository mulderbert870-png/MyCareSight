-- Backfill caregiver skill options from legacy CAREGIVER_SKILL_POINTS (constants.ts):
-- one credential_catalog (skill) + one task_catalog (category = UI "type") per row,
-- linked in task_required_credentials for getCaregiverSkillCatalogFromTaskRequirements.

create temporary table _cg_skill_backfill (
  category text not null,
  skill_name text not null,
  cred_code text not null,
  service_type text not null,
  is_skilled boolean not null,
  display_order integer not null
);

insert into _cg_skill_backfill (category, skill_name, cred_code, service_type, is_skilled, display_order)
values
  -- Clinical Care (skilled)
  ('Clinical Care', 'Wound Care', 'cred_cg_wound_care', 'skilled', true, 10),
  ('Clinical Care', 'Catheter Care', 'cred_cg_catheter_care', 'skilled', true, 20),
  ('Clinical Care', 'Ostomy Care', 'cred_cg_ostomy_care', 'skilled', true, 30),
  ('Clinical Care', 'Feeding Tube Care', 'cred_cg_feeding_tube_care', 'skilled', true, 40),
  ('Clinical Care', 'Tracheostomy Care', 'cred_cg_tracheostomy_care', 'skilled', true, 50),
  ('Clinical Care', 'Oxygen Therapy', 'cred_cg_oxygen_therapy', 'skilled', true, 60),
  ('Clinical Care', 'IV Therapy', 'cred_cg_iv_therapy', 'skilled', true, 70),
  ('Clinical Care', 'Insulin Administration', 'cred_cg_insulin_administration', 'skilled', true, 80),
  ('Clinical Care', 'Vital Signs Monitoring', 'cred_cg_vital_signs_monitoring', 'skilled', true, 90),
  ('Clinical Care', 'Dialysis Support', 'cred_cg_dialysis_support', 'skilled', true, 100),
  -- Specialty Conditions
  ('Specialty Conditions', 'Alzheimer''s / Dementia Care', 'cred_cg_alzheimers_dementia_care', 'skilled', true, 110),
  ('Specialty Conditions', 'Parkinson''s Care', 'cred_cg_parkinsons_care', 'skilled', true, 120),
  ('Specialty Conditions', 'Stroke Care', 'cred_cg_stroke_care', 'skilled', true, 130),
  ('Specialty Conditions', 'Multiple Sclerosis Care', 'cred_cg_ms_care', 'skilled', true, 140),
  ('Specialty Conditions', 'ALS Care', 'cred_cg_als_care', 'skilled', true, 150),
  ('Specialty Conditions', 'Traumatic Brain Injury Care', 'cred_cg_tbi_care', 'skilled', true, 160),
  ('Specialty Conditions', 'Hospice / Palliative Care', 'cred_cg_hospice_palliative_care', 'skilled', true, 170),
  ('Specialty Conditions', 'Post-Surgery Recovery', 'cred_cg_post_surgery_recovery', 'skilled', true, 180),
  ('Specialty Conditions', 'Diabetic Care', 'cred_cg_diabetic_care', 'skilled', true, 190),
  ('Specialty Conditions', 'Pediatric Care', 'cred_cg_pediatric_care', 'skilled', true, 200),
  ('Specialty Conditions', 'Autism Spectrum Care', 'cred_cg_autism_spectrum_care', 'skilled', true, 210),
  ('Specialty Conditions', 'Behavioral Health Support', 'cred_cg_behavioral_health_support', 'skilled', true, 220),
  -- Physical Support
  ('Physical Support', 'Transfer & Mobility Assistance', 'cred_cg_transfer_mobility_assistance', 'skilled', true, 230),
  ('Physical Support', 'Fall Prevention', 'cred_cg_fall_prevention', 'skilled', true, 240),
  ('Physical Support', 'Physical Therapy Assistance', 'cred_cg_pt_assistance', 'skilled', true, 250),
  ('Physical Support', 'Occupational Therapy Assistance', 'cred_cg_ot_assistance', 'skilled', true, 260),
  -- Daily Living (non-skilled)
  ('Daily Living', 'Meal Preparation', 'cred_cg_meal_preparation', 'non_skilled', false, 270),
  ('Daily Living', 'Housekeeping', 'cred_cg_housekeeping', 'non_skilled', false, 280),
  ('Daily Living', 'Medication Reminders', 'cred_cg_medication_reminders', 'non_skilled', false, 290),
  ('Daily Living', 'Companionship', 'cred_cg_companionship', 'non_skilled', false, 300),
  ('Daily Living', 'Transportation', 'cred_cg_transportation', 'non_skilled', false, 310),
  -- Certifications
  ('Certifications', 'CPR Certified', 'cred_cg_cpr_certified', 'skilled', true, 320),
  ('Certifications', 'AED Certified', 'cred_cg_aed_certified', 'skilled', true, 330),
  ('Certifications', 'First Aid Certified', 'cred_cg_first_aid_certified', 'skilled', true, 340),
  -- Language
  ('Language', 'Bilingual — Spanish', 'cred_cg_bilingual_spanish', 'skilled', true, 350),
  ('Language', 'Bilingual — French', 'cred_cg_bilingual_french', 'skilled', true, 360),
  ('Language', 'Bilingual — Mandarin', 'cred_cg_bilingual_mandarin', 'skilled', true, 370),
  ('Language', 'Bilingual — Portuguese', 'cred_cg_bilingual_portuguese', 'skilled', true, 380),
  ('Language', 'American Sign Language (ASL)', 'cred_cg_asl', 'skilled', true, 390);

insert into public.credential_catalog (code, name, credential_type, display_order)
select
  s.cred_code,
  s.skill_name,
  'skill',
  s.display_order
from _cg_skill_backfill s
on conflict (code) do update set
  name = excluded.name,
  credential_type = excluded.credential_type,
  display_order = excluded.display_order,
  updated_at = now();

insert into public.task_catalog (code, name, category, service_type, is_skilled, display_order)
select
  replace(s.cred_code, 'cred_', 'task_'),
  s.skill_name,
  s.category,
  s.service_type,
  s.is_skilled,
  s.display_order
from _cg_skill_backfill s
on conflict (code) do update set
  name = excluded.name,
  category = excluded.category,
  service_type = excluded.service_type,
  is_skilled = excluded.is_skilled,
  display_order = excluded.display_order,
  updated_at = now();

insert into public.task_required_credentials (task_id, credential_id, requirement_type)
select t.id, c.id, 'required'
from public.credential_catalog c
join public.task_catalog t on t.code = replace(c.code, 'cred_', 'task_')
where c.code in (select b.cred_code from _cg_skill_backfill b)
on conflict (task_id, credential_id) do nothing;
