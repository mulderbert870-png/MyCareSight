import type { Supabase } from '../types'

/** One row per assigned ADL (derived from patient_adl_day_schedule day_of_week=1). */
export interface PatientAdl {
  id: string
  patient_id: string
  adl_code: string
  display_order: number
  created_at: string
  updated_at: string
}

export interface PatientAdlDaySchedule {
  id: string
  patient_id: string
  adl_code: string
  day_of_week: number
  adl_note: string | null
  schedule_type: 'never' | 'always' | 'as_needed' | 'specific_times'
  times_per_day: number | null
  slot_morning: string | null
  slot_afternoon: string | null
  slot_evening: string | null
  slot_night: string | null
  display_order: number
  created_at: string
  updated_at: string
}

/** Get assigned ADLs for a patient (one row per ADL from day_of_week=1), ordered by display_order. */
export async function getAdlsByPatientId(supabase: Supabase, patientId: string) {
  return supabase
    .from('patient_adl_day_schedule')
    .select('*')
    .eq('patient_id', patientId)
    .eq('day_of_week', 1)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })
}

/** Insert one ADL assignment: create 7 rows (days 1–7) with schedule_type 'never'. Uses upsert to avoid duplicate key. */
export async function insertAdl(
  supabase: Supabase,
  data: { patient_id: string; adl_code: string; display_order?: number }
) {
  const displayOrder = data.display_order ?? 0
  const rows = [1, 2, 3, 4, 5, 6, 7].map((day_of_week) => ({
    patient_id: data.patient_id,
    adl_code: data.adl_code,
    day_of_week,
    schedule_type: 'never' as const,
    display_order: displayOrder,
  }))
  const { error } = await supabase
    .from('patient_adl_day_schedule')
    .upsert(rows, { onConflict: 'patient_id,adl_code,day_of_week', ignoreDuplicates: true })
  if (error) return { data: null, error }
  const { data: dayOne } = await supabase
    .from('patient_adl_day_schedule')
    .select('*')
    .eq('patient_id', data.patient_id)
    .eq('adl_code', data.adl_code)
    .eq('day_of_week', 1)
    .maybeSingle()
  return { data: dayOne ?? null, error: null }
}

/** Insert multiple ADL assignments; returns the day_of_week=1 row for each (for list display). Uses upsert to avoid duplicate key. */
export async function insertAdls(
  supabase: Supabase,
  patientId: string,
  adlCodes: string[],
  startDisplayOrder: number = 0
) {
  if (adlCodes.length === 0) return { data: [], error: null }
  const allRows: { patient_id: string; adl_code: string; day_of_week: number; schedule_type: 'never'; display_order: number }[] = []
  adlCodes.forEach((adl_code, i) => {
    const displayOrder = startDisplayOrder + i
    for (let d = 1; d <= 7; d++) {
      allRows.push({
        patient_id: patientId,
        adl_code,
        day_of_week: d,
        schedule_type: 'never',
        display_order: displayOrder,
      })
    }
  })
  const { error } = await supabase
    .from('patient_adl_day_schedule')
    .upsert(allRows, { onConflict: 'patient_id,adl_code,day_of_week', ignoreDuplicates: true })
  if (error) return { data: null, error }
  const { data: dayOneRows } = await supabase
    .from('patient_adl_day_schedule')
    .select('*')
    .eq('patient_id', patientId)
    .eq('day_of_week', 1)
    .in('adl_code', adlCodes)
    .order('display_order', { ascending: true })
  return { data: dayOneRows ?? [], error: null }
}

/** Delete one ADL assignment (all 7 day rows). */
export async function deleteAdl(supabase: Supabase, patientId: string, adlCode: string) {
  return supabase
    .from('patient_adl_day_schedule')
    .delete()
    .eq('patient_id', patientId)
    .eq('adl_code', adlCode)
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
    adl_note?: string | null
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
export async function updatePatientAdlDaySchedule(
  supabase: Supabase,
  data: {
    id: string
    adl_note?: string | null
  }
) {
  return supabase.from('patient_adl_day_schedule').update(data).eq('id', data.id).select().single()
}

/** Delete all day schedules for one ADL (when removing ADL from plan). Same as deleteAdl. */
export async function deletePatientAdlDaySchedulesForAdl(
  supabase: Supabase,
  patientId: string,
  adlCode: string
) {
  return deleteAdl(supabase, patientId, adlCode)
}
