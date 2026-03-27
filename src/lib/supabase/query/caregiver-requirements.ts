import type { Supabase } from '../types'

export interface CaregiverRequirement {
  id: string
  patient_id: string
  skill_codes: string[]
  created_at: string
  updated_at: string
}

/** Get caregiver requirements for a patient (at most one row). */
export async function getCaregiverRequirementsByPatientId(
  supabase: Supabase,
  patientId: string
) {
  return supabase
    .from('caregiver_requirements')
    .select('*')
    .eq('patient_id', patientId)
    .maybeSingle()
}

/** Batch-load caregiver requirements for many patients. */
export async function getCaregiverRequirementsByPatientIds(supabase: Supabase, patientIds: string[]) {
  if (patientIds.length === 0) return { data: [] as CaregiverRequirement[], error: null }
  return supabase.from('caregiver_requirements').select('*').in('patient_id', patientIds)
}

/** Upsert caregiver requirements for a patient (insert or update by patient_id). */
export async function upsertCaregiverRequirements(
  supabase: Supabase,
  patientId: string,
  skillCodes: string[]
) {
  return supabase
    .from('caregiver_requirements')
    .upsert(
      { patient_id: patientId, skill_codes: skillCodes },
      { onConflict: 'patient_id' }
    )
}
