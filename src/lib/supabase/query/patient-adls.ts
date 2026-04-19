import type { Supabase } from '../types'

/** One row per assigned ADL (day_of_week = 1 in patient_care_plan_tasks). */
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

function mapTaskToAdl(row: {
  id: string
  patient_id: string
  legacy_task_code: string | null
  display_order: number | null
  created_at: string
  updated_at: string
}): PatientAdl {
  return {
    id: row.id,
    patient_id: row.patient_id,
    adl_code: row.legacy_task_code ?? '',
    display_order: row.display_order ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function mapTaskToDaySchedule(row: {
  id: string
  patient_id: string
  legacy_task_code: string | null
  day_of_week: number
  task_note: string | null
  schedule_type: string | null
  times_per_day: number | null
  slot_morning: string | null
  slot_afternoon: string | null
  slot_evening: string | null
  slot_night: string | null
  display_order: number | null
  created_at: string
  updated_at: string
}): PatientAdlDaySchedule {
  return {
    id: row.id,
    patient_id: row.patient_id,
    adl_code: row.legacy_task_code ?? '',
    day_of_week: row.day_of_week,
    adl_note: row.task_note,
    schedule_type: (row.schedule_type as PatientAdlDaySchedule['schedule_type']) || 'never',
    times_per_day: row.times_per_day,
    slot_morning: row.slot_morning,
    slot_afternoon: row.slot_afternoon,
    slot_evening: row.slot_evening,
    slot_night: row.slot_night,
    display_order: row.display_order ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function requireAgencyIdForPatient(supabase: Supabase, patientId: string): Promise<string> {
  const { data } = await supabase.from('patients').select('agency_id').eq('id', patientId).maybeSingle()
  if (!data?.agency_id) throw new Error('Patient has no agency_id')
  return data.agency_id
}

/** Assigned ADLs for a patient (day_of_week = 1), ordered by display_order. */
export async function getAdlsByPatientId(supabase: Supabase, patientId: string) {
  const { data, error } = await supabase
    .from('patient_care_plan_tasks')
    .select('*')
    .eq('patient_id', patientId)
    .eq('service_type', 'non_skilled')
    .eq('day_of_week', 1)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return { data: null, error }
  return {
    data: (data ?? []).map((r) => mapTaskToAdl(r as Parameters<typeof mapTaskToAdl>[0])),
    error: null,
  }
}

/** Insert one ADL: upsert 7 rows (days 1–7) with schedule_type never. */
export async function insertAdl(
  supabase: Supabase,
  data: { patient_id: string; adl_code: string; display_order?: number }
) {
  const agencyId = await requireAgencyIdForPatient(supabase, data.patient_id)
  const displayOrder = data.display_order ?? 0
  const rows = [1, 2, 3, 4, 5, 6, 7].map((day_of_week) => ({
    agency_id: agencyId,
    patient_id: data.patient_id,
    legacy_task_code: data.adl_code,
    day_of_week,
    schedule_type: 'never' as const,
    service_type: 'non_skilled' as const,
    display_order: displayOrder,
  }))
  const { error } = await supabase
    .from('patient_care_plan_tasks')
    .upsert(rows, { onConflict: 'patient_id,legacy_task_code,day_of_week', ignoreDuplicates: true })
  if (error) return { data: null, error }
  const { data: dayOne } = await supabase
    .from('patient_care_plan_tasks')
    .select('*')
    .eq('patient_id', data.patient_id)
    .eq('service_type', 'non_skilled')
    .eq('legacy_task_code', data.adl_code)
    .eq('day_of_week', 1)
    .maybeSingle()
  return {
    data: dayOne ? mapTaskToAdl(dayOne as Parameters<typeof mapTaskToAdl>[0]) : null,
    error: null,
  }
}

/** Insert multiple ADLs; returns day_of_week=1 rows for list display. */
export async function insertAdls(
  supabase: Supabase,
  patientId: string,
  adlCodes: string[],
  startDisplayOrder: number = 0
) {
  if (adlCodes.length === 0) return { data: [], error: null }
  const agencyId = await requireAgencyIdForPatient(supabase, patientId)
  const allRows: {
    agency_id: string
    patient_id: string
    legacy_task_code: string
    day_of_week: number
    schedule_type: 'never'
    service_type: 'non_skilled'
    display_order: number
  }[] = []
  adlCodes.forEach((adl_code, i) => {
    const displayOrder = startDisplayOrder + i
    for (let d = 1; d <= 7; d++) {
      allRows.push({
        agency_id: agencyId,
        patient_id: patientId,
        legacy_task_code: adl_code,
        day_of_week: d,
        schedule_type: 'never',
        service_type: 'non_skilled',
        display_order: displayOrder,
      })
    }
  })
  const { error } = await supabase
    .from('patient_care_plan_tasks')
    .upsert(allRows, { onConflict: 'patient_id,legacy_task_code,day_of_week', ignoreDuplicates: true })
  if (error) return { data: null, error }
  const { data: dayOneRows } = await supabase
    .from('patient_care_plan_tasks')
    .select('*')
    .eq('patient_id', patientId)
    .eq('service_type', 'non_skilled')
    .eq('day_of_week', 1)
    .in('legacy_task_code', adlCodes)
    .order('display_order', { ascending: true })
  return {
    data: (dayOneRows ?? []).map((r) => mapTaskToAdl(r as Parameters<typeof mapTaskToAdl>[0])),
    error: null,
  }
}

/** Delete all day rows for one ADL code. Returns an error if the server deletes 0 rows (RLS or bad code). */
export async function deleteAdl(supabase: Supabase, patientId: string, adlCode: string) {
  const { data, error } = await supabase
    .from('patient_care_plan_tasks')
    .delete()
    .eq('patient_id', patientId)
    .eq('service_type', 'non_skilled')
    .eq('legacy_task_code', adlCode)
    .select('id')
  if (error) return { data: null, error }
  const deleted = data?.length ?? 0
  if (deleted === 0) {
    return {
      data: null,
      error: new Error(
        `Could not remove "${adlCode}" from the care plan (no rows deleted). Your account may not have permission to remove tasks.`
      ),
    }
  }
  return { data, error: null }
}

/** All per-day schedules for a patient. */
export async function getPatientAdlDaySchedulesByPatientId(supabase: Supabase, patientId: string) {
  const { data, error } = await supabase
    .from('patient_care_plan_tasks')
    .select('*')
    .eq('patient_id', patientId)
    .eq('service_type', 'non_skilled')
  if (error) return { data: null, error }
  return {
    data: (data ?? []).map((r) => mapTaskToDaySchedule(r as Parameters<typeof mapTaskToDaySchedule>[0])),
    error: null,
  }
}

/** Payload for upserting non-skilled per-day rows on `patient_care_plan_tasks`. */
export type PatientAdlDayScheduleUpsert = {
  patient_id: string
  adl_code: string
  day_of_week: number
  display_order?: number
  adl_note?: string | null
  schedule_type: 'never' | 'always' | 'as_needed' | 'specific_times'
  times_per_day?: number | null
  slot_morning?: string | null
  slot_afternoon?: string | null
  slot_evening?: string | null
  slot_night?: string | null
}

/**
 * Batch upsert all ADL day schedules in one round-trip (one `agency_id` lookup).
 * Prefer this over looping `upsertPatientAdlDaySchedule` from the client save path.
 */
export async function upsertPatientAdlDaySchedulesBatch(
  supabase: Supabase,
  patientId: string,
  rows: PatientAdlDayScheduleUpsert[]
): Promise<{ error: Error | null }> {
  if (rows.length === 0) return { error: null }
  const agencyId = await requireAgencyIdForPatient(supabase, patientId)
  const payloads = rows.map((data) => ({
    agency_id: agencyId,
    patient_id: data.patient_id,
    legacy_task_code: data.adl_code,
    day_of_week: data.day_of_week,
    display_order: data.display_order ?? 0,
    service_type: 'non_skilled' as const,
    task_note: data.adl_note ?? null,
    schedule_type: data.schedule_type,
    times_per_day: data.times_per_day ?? null,
    slot_morning: data.slot_morning ?? null,
    slot_afternoon: data.slot_afternoon ?? null,
    slot_evening: data.slot_evening ?? null,
    slot_night: data.slot_night ?? null,
  }))
  const chunkSize = 250
  for (let i = 0; i < payloads.length; i += chunkSize) {
    const chunk = payloads.slice(i, i + chunkSize)
    const { error } = await supabase
      .from('patient_care_plan_tasks')
      .upsert(chunk, { onConflict: 'patient_id,legacy_task_code,day_of_week' })
    if (error) return { error: new Error(error.message) }
  }
  return { error: null }
}

/** Upsert one day row (patient_id, legacy ADL code, day_of_week). */
export async function upsertPatientAdlDaySchedule(supabase: Supabase, data: PatientAdlDayScheduleUpsert) {
  return upsertPatientAdlDaySchedulesBatch(supabase, data.patient_id, [data])
}

export async function updatePatientAdlDaySchedule(
  supabase: Supabase,
  data: {
    id: string
    adl_note?: string | null
  }
) {
  return supabase
    .from('patient_care_plan_tasks')
    .update({ task_note: data.adl_note })
    .eq('id', data.id)
    .select()
    .single()
}

export async function deletePatientAdlDaySchedulesForAdl(
  supabase: Supabase,
  patientId: string,
  adlCode: string
) {
  return deleteAdl(supabase, patientId, adlCode)
}
