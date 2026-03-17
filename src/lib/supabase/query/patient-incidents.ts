import type { Supabase } from '../types'

export interface PatientIncident {
  id: string
  patient_id: string
  incident_date: string
  reporting_date: string
  primary_contact_person: string
  description: string
  file_path: string | null
  file_name: string | null
  created_at: string
  updated_at: string
}

/** Get incidents for a patient, ordered by reporting_date descending. */
export async function getIncidentsByPatientId(
  supabase: Supabase,
  patientId: string
) {
  return supabase
    .from('patient_incidents')
    .select('*')
    .eq('patient_id', patientId)
    .order('reporting_date', { ascending: false })
}

/** Insert an incident (file_path and file_name can be set later via update). */
export async function insertIncident(
  supabase: Supabase,
  data: {
    patient_id: string
    incident_date: string
    reporting_date: string
    primary_contact_person: string
    description: string
    file_path?: string | null
    file_name?: string | null
  }
) {
  return supabase.from('patient_incidents').insert(data).select().single()
}

/** Update an incident (e.g. to set file_path and file_name after upload). */
export async function updateIncident(
  supabase: Supabase,
  id: string,
  data: { file_path?: string | null; file_name?: string | null }
) {
  return supabase.from('patient_incidents').update(data).eq('id', id).select().single()
}

/** Delete an incident by id. */
export async function deleteIncident(supabase: Supabase, id: string) {
  return supabase.from('patient_incidents').delete().eq('id', id)
}
