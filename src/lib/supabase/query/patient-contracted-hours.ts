import type { Supabase } from '../types'

export interface PatientContractedHoursRow {
  id: string
  patient_id: string
  total_hours: number
  effective_date: string
  end_date: string | null
  note: string | null
  created_at: string
  updated_at: string
}

/** Get all contracted hours limits for a patient, ordered by effective_date desc. */
export async function getPatientContractedHoursByPatientId(supabase: Supabase, patientId: string) {
  return supabase
    .from('patient_contracted_hours')
    .select('*')
    .eq('patient_id', patientId)
    .order('effective_date', { ascending: false })
}

/** Insert a contracted hours limit. */
export async function insertPatientContractedHours(
  supabase: Supabase,
  data: {
    patient_id: string
    total_hours: number
    effective_date: string
    end_date?: string | null
    note?: string | null
  }
) {
  return supabase.from('patient_contracted_hours').insert(data).select().single()
}

/** Delete a contracted hours limit by id. */
export async function deletePatientContractedHours(supabase: Supabase, id: string) {
  return supabase.from('patient_contracted_hours').delete().eq('id', id)
}

/** Get the active limit that covers a given date (effective_date <= date and (end_date is null or end_date >= date)). */
export async function getActiveContractedHoursForDate(
  supabase: Supabase,
  patientId: string,
  date: string
) {
  const { data: rows } = await supabase
    .from('patient_contracted_hours')
    .select('*')
    .eq('patient_id', patientId)
    .lte('effective_date', date)
    .or(`end_date.is.null,end_date.gte.${date}`)
    .order('effective_date', { ascending: false })
    .limit(1)
  return rows?.[0] ?? null
}
