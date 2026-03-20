import type { Supabase } from '../types'

export interface ScheduleRow {
  id: string
  patient_id: string
  caregiver_id: string | null
  /** Encoded as `slotKey::adlName` (e.g. `morning::Bathing`) for per–time-slot assignments; legacy rows may store plain `adlName` only. */
  adl_codes: string[]
  date: string
  start_time: string | null
  end_time: string | null
  description: string | null
  type: string | null
  notes: string | null
  is_recurring: boolean | null
  repeat_frequency: string | null
  days_of_week: number[] | null
  repeat_monthly_rules: { ordinal: number; weekday: number }[] | null
  repeat_start: string | null
  repeat_end: string | null
  status: string | null
  created_at: string
  updated_at: string
}

/** Get all schedules for a patient. */
export async function getSchedulesByPatientId(
  supabase: Supabase,
  patientId: string
) {
  return supabase
    .from('schedules')
    .select('*')
    .eq('patient_id', patientId)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })
}

/** Get schedules for a patient within a date range (inclusive). */
export async function getSchedulesByPatientIdAndDateRange(
  supabase: Supabase,
  patientId: string,
  startDate: string,
  endDate: string
) {
  return supabase
    .from('schedules')
    .select('*')
    .eq('patient_id', patientId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })
}

/** Insert a schedule (visit) and return the row. */
export async function insertSchedule(
  supabase: Supabase,
  data: {
    patient_id: string
    caregiver_id?: string | null
    adl_codes?: string[]
    date: string
    start_time?: string | null
    end_time?: string | null
    description?: string | null
    type?: string | null
    notes?: string | null
    is_recurring?: boolean
    repeat_frequency?: string | null
    days_of_week?: number[] | null
    repeat_monthly_rules?: { ordinal: number; weekday: number }[] | null
    repeat_start?: string | null
    repeat_end?: string | null
  }
) {
  return supabase.from('schedules').insert(data).select().single()
}

/** Update a schedule by id. */
export async function updateSchedule(
  supabase: Supabase,
  id: string,
  data: {
    date?: string
    start_time?: string | null
    end_time?: string | null
    description?: string | null
    type?: string | null
    caregiver_id?: string | null
    notes?: string | null
    adl_codes?: string[]
    is_recurring?: boolean
    repeat_frequency?: string | null
    days_of_week?: number[] | null
    repeat_monthly_rules?: { ordinal: number; weekday: number }[] | null
    repeat_start?: string | null
    repeat_end?: string | null
    status?: string | null
  }
) {
  return supabase.from('schedules').update(data).eq('id', id).select().single()
}

/** Delete a schedule by id. */
export async function deleteSchedule(supabase: Supabase, id: string) {
  return supabase.from('schedules').delete().eq('id', id)
}
