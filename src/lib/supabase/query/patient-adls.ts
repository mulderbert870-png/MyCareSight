import type { Supabase } from '../types'

export interface PatientAdl {
  id: string
  patient_id: string
  adl_code: string
  frequency: string | null
  specific_times: string[] | null
  times_per_day: number | null
  selected: boolean | null
  display_order: number
  created_at: string
  updated_at: string
}

export interface PatientAdlDaySchedule {
  id: string
  patient_id: string
  adl_code: string
  day_of_week: number
  schedule_type: 'never' | 'always' | 'as_needed' | 'specific_times'
  times_per_day: number | null
  slot_morning: string | null
  slot_afternoon: string | null
  slot_evening: string | null
  slot_night: string | null
  created_at: string
  updated_at: string
}

/** Get assigned ADLs for a patient, ordered by display_order then created_at. */
export async function getAdlsByPatientId(supabase: Supabase, patientId: string) {
  return supabase
    .from('patient_adls')
    .select('*')
    .eq('patient_id', patientId)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })
}

/** Insert one ADL assignment. */
export async function insertAdl(
  supabase: Supabase,
  data: { patient_id: string; adl_code: string; display_order?: number }
) {
  return supabase.from('patient_adls').insert(data).select().single()
}

/** Insert multiple ADL assignments; returns inserted rows. */
export async function insertAdls(
  supabase: Supabase,
  patientId: string,
  adlCodes: string[],
  startDisplayOrder: number = 0
) {
  const rows = adlCodes.map((adl_code, i) => ({
    patient_id: patientId,
    adl_code,
    display_order: startDisplayOrder + i,
  }))
  return supabase.from('patient_adls').insert(rows).select()
}

/** Delete one ADL assignment by patient and adl_code. */
export async function deleteAdl(supabase: Supabase, patientId: string, adlCode: string) {
  return supabase.from('patient_adls').delete().eq('patient_id', patientId).eq('adl_code', adlCode)
}

/** Get all per-day schedules for a patient. */
export async function getPatientAdlDaySchedulesByPatientId(supabase: Supabase, patientId: string) {
  return supabase
    .from('patient_adl_day_schedule')
    .select('*')
    .eq('patient_id', patientId)
}

/** Upsert one day schedule (by patient_id, adl_code, day_of_week). */
export async function upsertPatientAdlDaySchedule(
  supabase: Supabase,
  data: {
    patient_id: string
    adl_code: string
    day_of_week: number
    schedule_type: 'never' | 'always' | 'as_needed' | 'specific_times'
    times_per_day?: number | null
    slot_morning?: string | null
    slot_afternoon?: string | null
    slot_evening?: string | null
    slot_night?: string | null
  }
) {
  return supabase
    .from('patient_adl_day_schedule')
    .upsert(data, { onConflict: 'patient_id,adl_code,day_of_week' })
    .select()
    .single()
}

/** Delete all day schedules for one ADL (when removing ADL from plan). */
export async function deletePatientAdlDaySchedulesForAdl(
  supabase: Supabase,
  patientId: string,
  adlCode: string
) {
  return supabase
    .from('patient_adl_day_schedule')
    .delete()
    .eq('patient_id', patientId)
    .eq('adl_code', adlCode)
}
