import type { Supabase } from '../types'

export interface PatientIncident {
  id: string
  patient_id: string
  reported_at: string
  description: string
  incident_type: string | null
  created_at: string
  updated_at: string
}

/** Get incidents for a patient, newest first. */
export async function getIncidentsByPatientId(
  supabase: Supabase,
  patientId: string
) {
  return supabase
    .from('patient_incidents')
    .select('*')
    .eq('patient_id', patientId)
    .order('reported_at', { ascending: false })
}

/** Insert an incident. */
export async function insertIncident(
  supabase: Supabase,
  data: {
    patient_id: string
    reported_at?: string
    description: string
    incident_type?: string | null
  }
) {
  return supabase.from('patient_incidents').insert(data).select().single()
}

/** Delete an incident by id. */
export async function deleteIncident(supabase: Supabase, id: string) {
  return supabase.from('patient_incidents').delete().eq('id', id)
}
