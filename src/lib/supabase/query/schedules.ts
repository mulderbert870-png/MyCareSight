import type { Supabase } from '../types'

/** Shape expected by visit dashboards and client visit UI (maps from scheduled_visits + tasks). */
export interface ScheduleRow {
  id: string
  patient_id: string
  caregiver_id: string | null
  contract_id: string | null
  service_type: string | null
  /** Encoded as `slotKey::adlName` or plain ADL name; sourced from scheduled_visit_tasks.legacy_task_code */
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

const visitSelect = `
  id,
  patient_id,
  caregiver_member_id,
  contract_id,
  service_type,
  visit_date,
  scheduled_start_time,
  scheduled_end_time,
  description,
  notes,
  visit_type,
  status,
  is_recurring,
  repeat_frequency,
  days_of_week,
  repeat_start,
  repeat_end,
  repeat_monthly_rules,
  created_at,
  updated_at,
  legacy_schedule_id
`

type ScheduledVisitDbRow = {
  id: string
  patient_id: string
  caregiver_member_id: string | null
  contract_id: string | null
  service_type: string | null
  visit_date: string
  scheduled_start_time: string | null
  scheduled_end_time: string | null
  description: string | null
  notes: string | null
  visit_type: string | null
  status: string
  is_recurring: boolean
  repeat_frequency: string | null
  days_of_week: number[] | null
  repeat_start: string | null
  repeat_end: string | null
  repeat_monthly_rules: unknown
  created_at: string
  updated_at: string
}

function parseMonthlyRules(raw: unknown): { ordinal: number; weekday: number }[] | null {
  if (raw == null) return null
  if (!Array.isArray(raw)) return null
  const out: { ordinal: number; weekday: number }[] = []
  for (const item of raw) {
    if (item && typeof item === 'object' && 'ordinal' in item && 'weekday' in item) {
      const o = (item as { ordinal: unknown; weekday: unknown }).ordinal
      const w = (item as { ordinal: unknown; weekday: unknown }).weekday
      if (typeof o === 'number' && typeof w === 'number') out.push({ ordinal: o, weekday: w })
    }
  }
  return out.length ? out : null
}

function toScheduleRow(v: ScheduledVisitDbRow, adlCodes: string[]): ScheduleRow {
  return {
    id: v.id,
    patient_id: v.patient_id,
    caregiver_id: v.caregiver_member_id,
    contract_id: v.contract_id,
    service_type: v.service_type,
    adl_codes: adlCodes,
    date: v.visit_date,
    start_time: v.scheduled_start_time,
    end_time: v.scheduled_end_time,
    description: v.description,
    type: v.visit_type,
    notes: v.notes,
    is_recurring: v.is_recurring,
    repeat_frequency: v.repeat_frequency,
    days_of_week: v.days_of_week,
    repeat_monthly_rules: parseMonthlyRules(v.repeat_monthly_rules),
    repeat_start: v.repeat_start,
    repeat_end: v.repeat_end,
    status: v.status,
    created_at: v.created_at,
    updated_at: v.updated_at,
  }
}

async function attachAdlCodes(
  supabase: Supabase,
  visits: ScheduledVisitDbRow[]
): Promise<ScheduleRow[]> {
  if (visits.length === 0) return []
  const ids = visits.map((v) => v.id)
  const { data: taskRows } = await supabase
    .from('scheduled_visit_tasks')
    .select('scheduled_visit_id, legacy_task_code, sort_order')
    .in('scheduled_visit_id', ids)

  type TaskRow = {
    scheduled_visit_id: string
    legacy_task_code: string | null
    sort_order: number | null
  }
  const grouped = new Map<string, TaskRow[]>()
  for (const row of taskRows ?? []) {
    const r = row as TaskRow
    const code = (r.legacy_task_code ?? '').trim()
    if (!code) continue
    const list = grouped.get(r.scheduled_visit_id) ?? []
    list.push({ ...r, legacy_task_code: code })
    grouped.set(r.scheduled_visit_id, list)
  }

  const byVisit = new Map<string, string[]>()
  grouped.forEach((list, visitId) => {
    list.sort((a: TaskRow, b: TaskRow) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    byVisit.set(
      visitId,
      list.map((x: TaskRow) => x.legacy_task_code!).filter(Boolean)
    )
  })

  return visits.map((v) => toScheduleRow(v, byVisit.get(v.id) ?? []))
}

/** Get all visits for a patient as ScheduleRow[]. */
export async function getSchedulesByPatientId(supabase: Supabase, patientId: string) {
  const { data, error } = await supabase
    .from('scheduled_visits')
    .select(visitSelect)
    .eq('patient_id', patientId)
    .order('visit_date', { ascending: true })
    .order('scheduled_start_time', { ascending: true })

  if (error) return { data: null, error }
  const rows = (data ?? []) as ScheduledVisitDbRow[]
  const mapped = await attachAdlCodes(supabase, rows)
  return { data: mapped, error: null }
}

/** Visits for a patient in an inclusive date range. */
export async function getSchedulesByPatientIdAndDateRange(
  supabase: Supabase,
  patientId: string,
  startDate: string,
  endDate: string
) {
  const { data, error } = await supabase
    .from('scheduled_visits')
    .select(visitSelect)
    .eq('patient_id', patientId)
    .gte('visit_date', startDate)
    .lte('visit_date', endDate)
    .order('visit_date', { ascending: true })
    .order('scheduled_start_time', { ascending: true })

  if (error) return { data: null, error }
  const rows = (data ?? []) as ScheduledVisitDbRow[]
  const mapped = await attachAdlCodes(supabase, rows)
  return { data: mapped, error: null }
}

/** All visits (e.g. coordinator dashboards), newest date first. */
export async function getAllScheduledVisitsAsScheduleRows(supabase: Supabase) {
  const { data, error } = await supabase
    .from('scheduled_visits')
    .select(visitSelect)
    .order('visit_date', { ascending: false })
    .order('scheduled_start_time', { ascending: true })

  if (error) return { data: null, error }
  const rows = (data ?? []) as ScheduledVisitDbRow[]
  const mapped = await attachAdlCodes(supabase, rows)
  return { data: mapped, error: null }
}

/** Visits by primary key (e.g. assignment requests referencing schedule_id = visit id). */
export async function getScheduledVisitsByIdsAsScheduleRows(supabase: Supabase, ids: string[]) {
  const clean = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0 && id !== 'null')))
  if (clean.length === 0) return { data: [], error: null }
  const { data, error } = await supabase.from('scheduled_visits').select(visitSelect).in('id', clean)
  if (error) return { data: null, error }
  const rows = (data ?? []) as ScheduledVisitDbRow[]
  const mapped = await attachAdlCodes(supabase, rows)
  return { data: mapped, error: null }
}

async function requirePatientAgencyId(
  supabase: Supabase,
  patientId: string
): Promise<{ agency_id: string } | { error: { message: string } }> {
  const { data, error } = await supabase.from('patients').select('agency_id').eq('id', patientId).single()
  if (error) return { error: { message: error.message } }
  const agencyId = (data as { agency_id: string | null })?.agency_id
  if (!agencyId) {
    return { error: { message: 'Patient must belong to an agency before scheduling visits.' } }
  }
  return { agency_id: agencyId }
}

async function replaceVisitTasks(
  supabase: Supabase,
  agencyId: string,
  visitId: string,
  adlCodes: string[] | undefined
) {
  await supabase.from('scheduled_visit_tasks').delete().eq('scheduled_visit_id', visitId)
  const codes = adlCodes ?? []
  if (codes.length === 0) return
  const rows = codes.map((code, i) => ({
    agency_id: agencyId,
    scheduled_visit_id: visitId,
    task_id: null as string | null,
    legacy_task_code: code,
    sort_order: i,
  }))
  await supabase.from('scheduled_visit_tasks').insert(rows)
}

async function replaceVisitTasksForMany(
  supabase: Supabase,
  agencyId: string,
  visitIds: string[],
  adlCodes: string[] | undefined
) {
  if (visitIds.length === 0) return
  await supabase.from('scheduled_visit_tasks').delete().in('scheduled_visit_id', visitIds)
  const codes = adlCodes ?? []
  if (codes.length === 0) return
  const rows = visitIds.flatMap((visitId) =>
    codes.map((code, i) => ({
      agency_id: agencyId,
      scheduled_visit_id: visitId,
      task_id: null as string | null,
      legacy_task_code: code,
      sort_order: i,
    }))
  )
  await supabase.from('scheduled_visit_tasks').insert(rows)
}

/** Insert a visit and return the row as ScheduleRow. */
export async function insertSchedule(
  supabase: Supabase,
  data: {
    patient_id: string
    caregiver_id?: string | null
    contract_id?: string | null
    service_type?: string | null
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
  const agency = await requirePatientAgencyId(supabase, data.patient_id)
  if ('error' in agency) return { data: null, error: agency.error }

  const monthly =
    data.repeat_monthly_rules && data.repeat_monthly_rules.length > 0
      ? data.repeat_monthly_rules
      : null

  const { data: visit, error } = await supabase
    .from('scheduled_visits')
    .insert({
      agency_id: agency.agency_id,
      patient_id: data.patient_id,
      caregiver_member_id: data.caregiver_id ?? null,
      contract_id: data.contract_id ?? null,
      service_type: data.service_type ?? 'non_skilled',
      visit_date: data.date,
      scheduled_start_time: data.start_time ?? null,
      scheduled_end_time: data.end_time ?? null,
      description: data.description ?? null,
      notes: data.notes ?? null,
      visit_type: data.type ?? null,
      status: 'scheduled',
      is_recurring: data.is_recurring ?? false,
      repeat_frequency: data.repeat_frequency ?? null,
      days_of_week: data.days_of_week?.length ? data.days_of_week.map((n) => Number(n)) : null,
      repeat_start: data.repeat_start ?? null,
      repeat_end: data.repeat_end ?? null,
      repeat_monthly_rules: monthly,
    })
    .select(visitSelect)
    .single()

  if (error || !visit) return { data: null, error }
  const v = visit as ScheduledVisitDbRow
  await replaceVisitTasks(supabase, agency.agency_id, v.id, data.adl_codes)
  const adlCodes = (data.adl_codes ?? []).filter(Boolean)
  return { data: toScheduleRow(v, adlCodes), error: null }
}

/** Create one visit_series template and many dated scheduled_visits linked to it. */
export async function insertRecurringSchedulesFromSeries(
  supabase: Supabase,
  data: {
    patient_id: string
    caregiver_id?: string | null
    contract_id?: string | null
    service_type?: string | null
    adl_codes?: string[]
    dates: string[]
    start_time?: string | null
    end_time?: string | null
    description?: string | null
    type?: string | null
    notes?: string | null
    repeat_frequency?: string | null
    days_of_week?: number[] | null
    repeat_monthly_rules?: { ordinal: number; weekday: number }[] | null
    repeat_start: string
    repeat_end?: string | null
  }
) {
  if (data.dates.length === 0) return { data: [], error: { message: 'No dates to insert.' } }
  const agency = await requirePatientAgencyId(supabase, data.patient_id)
  if ('error' in agency) return { data: null, error: agency.error }

  const monthly =
    data.repeat_monthly_rules && data.repeat_monthly_rules.length > 0
      ? data.repeat_monthly_rules
      : null

  const { data: series, error: seriesError } = await supabase
    .from('visit_series')
    .insert({
      agency_id: agency.agency_id,
      patient_id: data.patient_id,
      primary_caregiver_member_id: data.caregiver_id ?? null,
      contract_id: data.contract_id ?? null,
      service_type: data.service_type ?? 'non_skilled',
      series_name: data.type ?? null,
      repeat_frequency: data.repeat_frequency ?? null,
      days_of_week: data.days_of_week?.length ? data.days_of_week.map((n) => Number(n)) : null,
      repeat_start: data.repeat_start,
      repeat_end: data.repeat_end ?? null,
      repeat_monthly_rules: monthly,
      notes: data.notes ?? null,
      status: 'active',
    })
    .select('id')
    .single()

  if (seriesError || !series?.id) return { data: null, error: seriesError ?? { message: 'Failed to create visit series.' } }

  const rows = data.dates.map((dateStr) => ({
    agency_id: agency.agency_id,
    visit_series_id: series.id,
    patient_id: data.patient_id,
    caregiver_member_id: data.caregiver_id ?? null,
    contract_id: data.contract_id ?? null,
    service_type: data.service_type ?? 'non_skilled',
    visit_date: dateStr,
    scheduled_start_time: data.start_time ?? null,
    scheduled_end_time: data.end_time ?? null,
    description: data.description ?? null,
    notes: data.notes ?? null,
    visit_type: data.type ?? null,
    status: 'scheduled',
    is_recurring: true,
    repeat_frequency: data.repeat_frequency ?? null,
    days_of_week: data.days_of_week?.length ? data.days_of_week.map((n) => Number(n)) : null,
    repeat_start: data.repeat_start,
    repeat_end: data.repeat_end ?? null,
    repeat_monthly_rules: monthly,
  }))

  const { data: visits, error: visitsError } = await supabase
    .from('scheduled_visits')
    .insert(rows)
    .select(visitSelect)

  if (visitsError) return { data: null, error: visitsError }
  const inserted = (visits ?? []) as ScheduledVisitDbRow[]
  await replaceVisitTasksForMany(
    supabase,
    agency.agency_id,
    inserted.map((v) => v.id),
    data.adl_codes
  )
  const codes = (data.adl_codes ?? []).filter(Boolean)
  return { data: inserted.map((v) => toScheduleRow(v, codes)), error: null }
}

/** Update a visit by id. */
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
    contract_id?: string | null
    service_type?: string | null
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
  const { data: existing, error: fetchErr } = await supabase
    .from('scheduled_visits')
    .select('id, agency_id, patient_id')
    .eq('id', id)
    .single()

  if (fetchErr) return { data: null, error: fetchErr }
  if (!existing) return { data: null, error: { message: 'Visit not found' } }

  const ex = existing as { id: string; agency_id: string; patient_id: string }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (data.date !== undefined) patch.visit_date = data.date
  if (data.start_time !== undefined) patch.scheduled_start_time = data.start_time
  if (data.end_time !== undefined) patch.scheduled_end_time = data.end_time
  if (data.description !== undefined) patch.description = data.description
  if (data.type !== undefined) patch.visit_type = data.type
  if (data.caregiver_id !== undefined) patch.caregiver_member_id = data.caregiver_id
  if (data.contract_id !== undefined) patch.contract_id = data.contract_id
  if (data.service_type !== undefined) patch.service_type = data.service_type
  if (data.notes !== undefined) patch.notes = data.notes
  if (data.is_recurring !== undefined) patch.is_recurring = data.is_recurring
  if (data.repeat_frequency !== undefined) patch.repeat_frequency = data.repeat_frequency
  if (data.days_of_week !== undefined) {
    patch.days_of_week = data.days_of_week?.length ? data.days_of_week.map((n) => Number(n)) : null
  }
  if (data.repeat_start !== undefined) patch.repeat_start = data.repeat_start
  if (data.repeat_end !== undefined) patch.repeat_end = data.repeat_end
  if (data.repeat_monthly_rules !== undefined) {
    patch.repeat_monthly_rules =
      data.repeat_monthly_rules && data.repeat_monthly_rules.length > 0 ? data.repeat_monthly_rules : null
  }
  if (data.status !== undefined) {
    patch.status = data.status === null || data.status === '' ? 'scheduled' : data.status
  }

  const { data: visit, error } = await supabase
    .from('scheduled_visits')
    .update(patch)
    .eq('id', id)
    .select(visitSelect)
    .single()

  if (error || !visit) return { data: null, error }
  const v = visit as ScheduledVisitDbRow

  if (data.adl_codes !== undefined) {
    await replaceVisitTasks(supabase, ex.agency_id, id, data.adl_codes)
    return { data: toScheduleRow(v, data.adl_codes.filter(Boolean)), error: null }
  }

  const mapped = await attachAdlCodes(supabase, [v])
  return { data: mapped[0] ?? null, error: null }
}

/** Delete a visit by id (cascade removes scheduled_visit_tasks). */
export async function deleteSchedule(supabase: Supabase, id: string) {
  return supabase.from('scheduled_visits').delete().eq('id', id)
}
