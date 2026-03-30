import type { Supabase } from '../types'

export interface CaregiverRequirement {
  id: string
  patient_id: string
  skill_codes: string[]
  created_at: string
  updated_at: string
}

async function getPatientAgencyId(supabase: Supabase, patientId: string): Promise<string | null> {
  const { data } = await supabase.from('patients').select('agency_id').eq('id', patientId).maybeSingle()
  return data?.agency_id ?? null
}

/** Get skill requirements for a patient (at most one row). */
export async function getCaregiverRequirementsByPatientId(
  supabase: Supabase,
  patientId: string
) {
  return supabase
    .from('patient_skill_requirements')
    .select('*')
    .eq('patient_id', patientId)
    .maybeSingle()
}

/** Batch-load skill requirements for many patients. */
export async function getCaregiverRequirementsByPatientIds(supabase: Supabase, patientIds: string[]) {
  if (patientIds.length === 0) return { data: [] as CaregiverRequirement[], error: null }
  return supabase.from('patient_skill_requirements').select('*').in('patient_id', patientIds)
}

/** Upsert skill requirements for a patient. */
export async function upsertCaregiverRequirements(
  supabase: Supabase,
  patientId: string,
  skillCodes: string[]
) {
  const agencyId = await getPatientAgencyId(supabase, patientId)
  if (!agencyId) {
    return {
      data: null,
      error: { message: 'Patient has no agency_id; cannot save skill requirements.', details: '', hint: '', code: '' },
    }
  }
  return supabase
    .from('patient_skill_requirements')
    .upsert(
      { patient_id: patientId, agency_id: agencyId, skill_codes: skillCodes },
      { onConflict: 'patient_id' }
    )
}
