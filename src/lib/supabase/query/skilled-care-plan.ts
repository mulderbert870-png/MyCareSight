import type { Supabase } from '../types'

export type SkilledCarePlanTask = {
  id: string
  patient_id: string
  task_id: string
  category: string
  name: string
  description: string | null
  display_order: number
}

/** Per-day schedule row for a skilled task (mirrors patient ADL day rows). */
export interface PatientSkilledTaskDaySchedule {
  id: string
  patient_id: string
  task_id: string
  day_of_week: number
  task_note: string | null
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

type TaskCategoryNest = { name?: string | null } | null

type SkilledTaskRow = {
  id: string
  patient_id: string
  task_id: string | null
  display_order: number | null
  task_catalog:
    | {
        name: string | null
        description: string | null
        task_categories?: TaskCategoryNest | TaskCategoryNest[] | null
      }
    | {
        name: string | null
        description: string | null
        task_categories?: TaskCategoryNest | TaskCategoryNest[] | null
      }[]
    | null
}

function firstNest<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

function firstCatalog(
  v: SkilledTaskRow['task_catalog']
): { category: string | null; name: string | null; description: string | null } | null {
  if (!v) return null
  const row = Array.isArray(v) ? v[0] ?? null : v
  if (!row) return null
  const tc = firstNest(row.task_categories)
  return {
    category: tc?.name ?? null,
    name: row.name ?? null,
    description: row.description ?? null,
  }
}

type CatalogRow = {
  category: string | null
  name: string | null
  description: string | null
}

function mapSkilledDayRow(row: {
  id: string
  patient_id: string
  task_id: string | null
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
}): PatientSkilledTaskDaySchedule {
  return {
    id: row.id,
    patient_id: row.patient_id,
    task_id: row.task_id ?? '',
    day_of_week: row.day_of_week,
    task_note: row.task_note,
    schedule_type: (row.schedule_type as PatientSkilledTaskDaySchedule['schedule_type']) || 'never',
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

/** Skilled tasks on the plan (canonical row per task: day_of_week = 1). */
export async function getPatientSkilledCarePlanTasks(supabase: Supabase, patientId: string) {
  const { data, error } = await supabase
    .from('patient_care_plan_tasks')
    .select('id, patient_id, task_id, display_order, task_catalog(name, description, task_categories(name))')
    .eq('patient_id', patientId)
    .eq('service_type', 'skilled')
    .eq('day_of_week', 1)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return { data: null, error }
  const mapped = ((data ?? []) as SkilledTaskRow[])
    .map((r) => ({ r, c: firstCatalog(r.task_catalog) as CatalogRow | null }))
    .filter(({ r, c }) => !!r.task_id && !!c?.name)
    .map(({ r, c }) => ({
      id: r.id,
      patient_id: r.patient_id,
      task_id: r.task_id as string,
      category: (c?.category ?? 'General').trim() || 'General',
      name: (c?.name ?? '').trim(),
      description: c?.description ?? null,
      display_order: r.display_order ?? 0,
    }))
  return { data: mapped, error: null }
}

/** All per-day skilled schedule rows (7 rows per task when fully configured). */
export async function getPatientSkilledDaySchedulesByPatientId(supabase: Supabase, patientId: string) {
  const { data, error } = await supabase
    .from('patient_care_plan_tasks')
    .select('*')
    .eq('patient_id', patientId)
    .eq('service_type', 'skilled')
    .not('task_id', 'is', null)
    .order('display_order', { ascending: true })
    .order('day_of_week', { ascending: true })
  if (error) return { data: null, error }
  return {
    data: (data ?? []).map((r) => mapSkilledDayRow(r as Parameters<typeof mapSkilledDayRow>[0])),
    error: null,
  }
}

/** Payload for upserting skilled per-day rows on `patient_care_plan_tasks`. */
export type PatientSkilledTaskDayScheduleUpsert = {
  patient_id: string
  task_id: string
  day_of_week: number
  display_order?: number
  task_note?: string | null
  schedule_type: 'never' | 'always' | 'as_needed' | 'specific_times'
  times_per_day?: number | null
  slot_morning?: string | null
  slot_afternoon?: string | null
  slot_evening?: string | null
  slot_night?: string | null
}

type SkilledCarePlanTaskDbRow = {
  agency_id: string
  patient_id: string
  task_id: string
  legacy_task_code: string | null
  day_of_week: number
  display_order: number
  service_type: 'skilled'
  task_note: string | null
  schedule_type: string
  times_per_day: number | null
  slot_morning: string | null
  slot_afternoon: string | null
  slot_evening: string | null
  slot_night: string | null
}

/**
 * Batch save skilled day rows (same idea as non-skilled `upsertPatientAdlDaySchedulesBatch`):
 * one `agency_id` fetch, one load of existing ids, then chunked writes.
 *
 * Skilled rows cannot use `ON CONFLICT (patient_id, task_id, day_of_week)` (partial unique → 42P10).
 * Mixed `upsert` on `id` sends explicit null `id` for new rows (23502). So: **insert** new rows
 * without an `id` field (DB default), **upsert** only rows that already have an `id`.
 */
export async function upsertPatientSkilledTaskDaySchedulesBatch(
  supabase: Supabase,
  patientId: string,
  rows: PatientSkilledTaskDayScheduleUpsert[]
): Promise<{ error: Error | null }> {
  if (rows.length === 0) return { error: null }
  const agencyId = await requireAgencyIdForPatient(supabase, patientId)
  const { data: existingRows, error: existingErr } = await supabase
    .from('patient_care_plan_tasks')
    .select('id, task_id, day_of_week')
    .eq('patient_id', patientId)
    .eq('service_type', 'skilled')
    .not('task_id', 'is', null)
  if (existingErr) return { error: new Error(existingErr.message) }

  const idByTaskAndDay = new Map<string, string>()
  for (const r of existingRows ?? []) {
    const tid = r.task_id as string | null | undefined
    if (!tid) continue
    idByTaskAndDay.set(`${tid}|${r.day_of_week}`, r.id as string)
  }

  const toInsert: SkilledCarePlanTaskDbRow[] = []
  const toUpdate: Array<SkilledCarePlanTaskDbRow & { id: string }> = []

  for (const data of rows) {
    const key = `${data.task_id}|${data.day_of_week}`
    const existingId = idByTaskAndDay.get(key)
    const base: SkilledCarePlanTaskDbRow = {
      agency_id: agencyId,
      patient_id: data.patient_id,
      task_id: data.task_id,
      legacy_task_code: null,
      day_of_week: data.day_of_week,
      display_order: data.display_order ?? 0,
      service_type: 'skilled',
      task_note: data.task_note ?? null,
      schedule_type: data.schedule_type,
      times_per_day: data.times_per_day ?? null,
      slot_morning: data.slot_morning ?? null,
      slot_afternoon: data.slot_afternoon ?? null,
      slot_evening: data.slot_evening ?? null,
      slot_night: data.slot_night ?? null,
    }
    if (existingId) {
      toUpdate.push({ id: existingId, ...base })
    } else {
      toInsert.push(base)
    }
  }

  const chunkSize = 250
  for (let i = 0; i < toInsert.length; i += chunkSize) {
    const chunk = toInsert.slice(i, i + chunkSize)
    const { error } = await supabase.from('patient_care_plan_tasks').insert(chunk)
    if (error) return { error: new Error(error.message) }
  }
  for (let i = 0; i < toUpdate.length; i += chunkSize) {
    const chunk = toUpdate.slice(i, i + chunkSize)
    const { error } = await supabase.from('patient_care_plan_tasks').upsert(chunk, { onConflict: 'id' })
    if (error) return { error: new Error(error.message) }
  }
  return { error: null }
}

export async function upsertPatientSkilledTaskDaySchedule(
  supabase: Supabase,
  data: PatientSkilledTaskDayScheduleUpsert
) {
  return upsertPatientSkilledTaskDaySchedulesBatch(supabase, data.patient_id, [data])
}

export async function updatePatientSkilledTaskDayScheduleNote(
  supabase: Supabase,
  data: { id: string; task_note?: string | null }
) {
  return supabase
    .from('patient_care_plan_tasks')
    .update({ task_note: data.task_note })
    .eq('id', data.id)
    .select()
    .single()
}

/** Remove all skilled plan rows for the given tasks (all days) in one request. */
export async function deleteSkilledTaskPlanRowsBatch(
  supabase: Supabase,
  patientId: string,
  taskIds: string[]
): Promise<{ error: Error | null }> {
  if (taskIds.length === 0) return { error: null }
  const { error } = await supabase
    .from('patient_care_plan_tasks')
    .delete()
    .eq('patient_id', patientId)
    .eq('service_type', 'skilled')
    .in('task_id', taskIds)
  return { error: error ? new Error(error.message) : null }
}

/** Remove all skilled plan rows for one task (all days). */
export async function deleteSkilledTaskPlanRows(supabase: Supabase, patientId: string, taskId: string) {
  return deleteSkilledTaskPlanRowsBatch(supabase, patientId, [taskId])
}
