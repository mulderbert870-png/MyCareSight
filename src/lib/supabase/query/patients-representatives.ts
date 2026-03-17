import type { Supabase } from '../types'

export interface PatientRepresentative {
  id: string
  patient_id: string
  name: string | null
  relationship: string | null
  phone_number: string | null
  email_address: string | null
  display_order: number
  created_at: string
  updated_at: string
}

/** Get representatives for a patient, ordered by display_order. */
export async function getRepresentativesByPatientId(
  supabase: Supabase,
  patientId: string
) {
  return supabase
    .from('patients_representatives')
    .select('*')
    .eq('patient_id', patientId)
    .order('display_order', { ascending: true })
}

/** Insert a representative and return the inserted row. */
export async function insertRepresentative(
  supabase: Supabase,
  data: {
    patient_id: string
    name: string | null
    relationship?: string | null
    phone_number?: string | null
    email_address?: string | null
    display_order: number
  }
) {
  return supabase.from('patients_representatives').insert(data).select().single()
}

/** Update a representative by id. */
export async function updateRepresentative(
  supabase: Supabase,
  id: string,
  data: {
    name?: string | null
    relationship?: string | null
    phone_number?: string | null
    email_address?: string | null
    display_order?: number
  }
) {
  return supabase.from('patients_representatives').update(data).eq('id', id)
}

/** Delete a representative by id. */
export async function deleteRepresentative(supabase: Supabase, id: string) {
  return supabase.from('patients_representatives').delete().eq('id', id)
}
