import zipcodes from 'zipcodes'
import type { Supabase } from '@/lib/supabase/types'
import * as q from '@/lib/supabase/query'
import type { ScheduleRow } from '@/lib/supabase/query/schedules'
import type { ScheduleAssignmentRequestRow } from '@/lib/supabase/query/schedule-assignment-requests'
import { overallScorePercent, proximityPercentFromMiles } from '@/lib/visit-assignment-scoring'

export type AssignmentRequestCardDTO = {
  id: string
  caregiverName: string
  caregiverTitle: string
  skillMatchPercent: number
  distanceMiles: number
  cityLabel: string
  matchedSkills: string[]
  note: string
  requestedAtLabel: string
  proximityPercent: number
  overallPercent: number
}

export type AssignmentVisitCardDTO = {
  id: string
  visitTitle: string
  clientName: string
  dateLabel: string
  timeLabel: string
  locationLabel: string
  requests: AssignmentRequestCardDTO[]
}

export type ResolvedAssignmentRowDTO = {
  id: string
  kind: 'approved' | 'declined'
  caregiverName: string
  visitTitle: string
  clientName: string
  visitDateLabel: string
  resolvedAtLabel: string
  reason?: string
}

function normalizeUsZipForLookup(zip: unknown): string | null {
  if (zip === null || zip === undefined) return null
  const s = String(zip).trim()
  if (!s) return null
  const digits = s.replace(/\D/g, '').slice(0, 5)
  return digits.length === 5 ? digits : null
}

function formatScheduleDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTimePart(t: string | null | undefined): string {
  if (!t) return ''
  const s = String(t).slice(0, 5)
  return s
}

function formatTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  const a = formatTimePart(start)
  const b = formatTimePart(end)
  if (a && b) return `${a}–${b}`
  return a || b || '—'
}

function patientLocationLabel(patient: {
  zip_code?: string | null
  state?: string | null
  city?: string | null
  street_address?: string | null
}): string {
  const z = normalizeUsZipForLookup(patient.zip_code)
  if (z) {
    const loc = zipcodes.lookup(z)
    if (loc?.city && loc?.state) return `${loc.city}, ${loc.state}`
  }
  if (patient.city && patient.state) return `${patient.city}, ${patient.state}`
  if (patient.state) return String(patient.state)
  if (patient.street_address) return String(patient.street_address).split(',')[0]?.trim() || '—'
  return '—'
}

function staffCityLabel(zip: unknown): string {
  const z = normalizeUsZipForLookup(zip)
  if (!z) return '—'
  const loc = zipcodes.lookup(z)
  if (loc?.city && loc?.state) return `${loc.city}, ${loc.state}`
  return z
}

function visitTitleFromSchedule(s: ScheduleRow, taskNameById?: Map<string, string>): string {
  const tasks = decodeAdlCodes(s.adl_codes, taskNameById)
  if (tasks.length > 0) return tasks.join(', ')
  const t = (s.type ?? '').trim()
  if (t) return t
  const d = (s.description ?? '').trim()
  if (d) return d.length > 80 ? `${d.slice(0, 77)}…` : d
  return 'Care visit'
}

function decodeAdlCodes(codes: string[] | null | undefined, taskNameById?: Map<string, string>): string[] {
  if (!Array.isArray(codes)) return []
  return codes
    .map((code) => {
      const v = String(code || '').trim()
      if (!v) return ''
      const parts = v.split('::')
      const token = (parts.length > 1 ? parts[1] : parts[0]).trim()
      if (!token) return ''
      const mapped = taskNameById?.get(token)
      return (mapped && mapped.trim()) || token
    })
    .filter(Boolean)
}

function extractTaskToken(raw: string): string {
  const v = String(raw || '').trim()
  if (!v) return ''
  const parts = v.split('::')
  return (parts.length > 1 ? parts[1] : parts[0]).trim()
}

function isUuidLike(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

/** Drop null/undefined/string "null" so `.in('id', ids)` never sends invalid uuid text to Postgres. */
function sanitizeUuidList(ids: unknown[]): string[] {
  return Array.from(new Set(ids.filter((x): x is string => typeof x === 'string' && x.length > 0 && x !== 'null')))
}

function skillMatchForStaff(
  requiredSkills: string[],
  caregiverSkills: string[]
): { percent: number; matched: string[] } {
  const requiredLen = requiredSkills.length
  if (requiredLen === 0) return { percent: 100, matched: [] }
  const matched = requiredSkills.filter((sk) => caregiverSkills.includes(sk))
  return { percent: Math.round((matched.length / requiredLen) * 100), matched }
}

function formatRequestedAt(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatResolvedAt(iso: string): string {
  return formatRequestedAt(iso)
}

type PatientRow = {
  id: string
  full_name?: string | null
  zip_code?: string | null
  state?: string | null
  city?: string | null
  street_address?: string | null
}

type StaffRow = {
  id: string
  first_name?: string | null
  last_name?: string | null
  zip_code?: string | null
  skills?: string[] | null
  /** Staff role label stored on the row (not a FK to caregiver_roles in this schema). */
  role?: string | null
  job_title?: string | null
}

/** Load and shape data for Visit Management → Assignment Requests. */
export async function fetchVisitAssignmentDashboardData(supabase: Supabase): Promise<{
  visits: AssignmentVisitCardDTO[]
  resolved: ResolvedAssignmentRowDTO[]
  approvedTotal: number
  declinedTotal: number
  error?: string
}> {
  const [pendingRes, resolvedRes, approvedCountRes, declinedCountRes] = await Promise.all([
    q.getPendingScheduleAssignmentRequests(supabase),
    q.getRecentResolvedScheduleAssignmentRequests(supabase, 40),
    supabase.from('schedule_assignment_requests').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    supabase.from('schedule_assignment_requests').select('id', { count: 'exact', head: true }).eq('status', 'declined'),
  ])

  if (pendingRes.error) {
    return { visits: [], resolved: [], approvedTotal: 0, declinedTotal: 0, error: pendingRes.error.message }
  }
  if (resolvedRes.error) {
    return { visits: [], resolved: [], approvedTotal: 0, declinedTotal: 0, error: resolvedRes.error.message }
  }
  if (approvedCountRes.error) {
    return { visits: [], resolved: [], approvedTotal: 0, declinedTotal: 0, error: approvedCountRes.error.message }
  }
  if (declinedCountRes.error) {
    return { visits: [], resolved: [], approvedTotal: 0, declinedTotal: 0, error: declinedCountRes.error.message }
  }

  const approvedTotal = approvedCountRes.count ?? 0
  const declinedTotal = declinedCountRes.count ?? 0

  const pendingRows = (pendingRes.data ?? []) as ScheduleAssignmentRequestRow[]
  const resolvedRows = (resolvedRes.data ?? []) as ScheduleAssignmentRequestRow[]

  const scheduleIds = sanitizeUuidList(pendingRows.map((r) => r.schedule_id))
  const resolvedScheduleIds = sanitizeUuidList(resolvedRows.map((r) => r.schedule_id))

  if (scheduleIds.length === 0 && resolvedScheduleIds.length === 0) {
    return { visits: [], resolved: [], approvedTotal, declinedTotal }
  }

  const allScheduleIds = sanitizeUuidList(scheduleIds.concat(resolvedScheduleIds))

  const { data: schedulesData, error: schedErr } = await q.getScheduledVisitsByIdsAsScheduleRows(
    supabase,
    allScheduleIds
  )

  if (schedErr) {
    return { visits: [], resolved: [], approvedTotal, declinedTotal, error: schedErr.message }
  }

  const schedules = (schedulesData ?? []) as ScheduleRow[]
  const scheduleById = new Map(schedules.map((s) => [s.id, s]))

  const taskIdTokens = Array.from(
    new Set(
      schedules
        .flatMap((s) => s.adl_codes ?? [])
        .map((raw) => extractTaskToken(raw))
        .filter((token) => token && isUuidLike(token))
    )
  )
  const taskNameById = new Map<string, string>()
  if (taskIdTokens.length > 0) {
    const { data: taskRows } = await supabase.from('task_catalog').select('id, name, code').in('id', taskIdTokens)
    for (const row of taskRows ?? []) {
      const r = row as { id?: string | null; name?: string | null; code?: string | null }
      const id = (r.id ?? '').trim()
      if (!id) continue
      const label = (r.name ?? '').trim() || (r.code ?? '').trim()
      if (label) taskNameById.set(id, label)
    }
  }

  const patientIds = sanitizeUuidList(schedules.map((s) => s.patient_id))
  const staffIds = new Set<string>()
  for (const r of pendingRows) {
    if (r.caregiver_member_id) staffIds.add(r.caregiver_member_id)
  }
  for (const r of resolvedRows) {
    if (r.caregiver_member_id) staffIds.add(r.caregiver_member_id)
  }
  const staffIdList = sanitizeUuidList(Array.from(staffIds))

  const { data: patientsData, error: patErr } =
    patientIds.length === 0
      ? { data: [] as PatientRow[], error: null }
      : await supabase
          .from('patients')
          .select('id, full_name, zip_code, state, city, street_address')
          .in('id', patientIds)

  if (patErr) {
    return { visits: [], resolved: [], approvedTotal, declinedTotal, error: patErr.message }
  }

  const { data: staffData, error: staffErr } =
    staffIdList.length === 0
      ? { data: [] as StaffRow[], error: null }
      : await supabase
          .from('caregiver_members')
          .select('id, first_name, last_name, zip_code, skills, role, job_title')
          .in('id', staffIdList)

  if (staffErr) {
    return { visits: [], resolved: [], approvedTotal, declinedTotal, error: staffErr.message }
  }

  const patientById = new Map((patientsData as PatientRow[] | null)?.map((p) => [p.id, p]) ?? [])
  const staffById = new Map((staffData as StaffRow[] | null)?.map((s) => [s.id, s]) ?? [])

  const { data: reqRows } = await q.getCaregiverRequirementsByPatientIds(supabase, patientIds)
  const requirementsByPatient = new Map<string, string[]>()
  for (const row of reqRows ?? []) {
    const pr = row as { patient_id?: string; skill_codes?: string[] }
    if (pr.patient_id && Array.isArray(pr.skill_codes)) {
      requirementsByPatient.set(pr.patient_id, pr.skill_codes)
    }
  }

  type PendingAgg = {
    scheduleId: string
    requests: AssignmentRequestCardDTO[]
  }
  const bySchedule = new Map<string, PendingAgg>()

  for (const row of pendingRows) {
    const sched = scheduleById.get(row.schedule_id)
    if (!sched || sched.caregiver_id) continue

    const patient = patientById.get(sched.patient_id)
    const staff = staffById.get(row.caregiver_member_id)
    if (!patient || !staff) continue

    const clientZip = normalizeUsZipForLookup(patient.zip_code)
    const staffZip = normalizeUsZipForLookup(staff.zip_code)
    let distanceMiles = Number.POSITIVE_INFINITY
    if (clientZip && staffZip) {
      const d = zipcodes.distance(clientZip, staffZip)
      if (d != null && Number.isFinite(d)) distanceMiles = d
    }

    const proximity = proximityPercentFromMiles(distanceMiles)
    if (proximity === null) continue

    const caregiverSkills = Array.isArray(staff.skills) ? staff.skills : []
    const required = requirementsByPatient.get(patient.id) ?? []
    const { percent: skillPct, matched } = skillMatchForStaff(required, caregiverSkills)

    const caregiverName = [staff.first_name, staff.last_name].filter(Boolean).join(' ') || 'Caregiver'
    const caregiverTitle =
      (staff.job_title && staff.job_title.trim()) || (staff.role && String(staff.role).trim()) || 'Caregiver'

    const card: AssignmentRequestCardDTO = {
      id: row.id,
      caregiverName,
      caregiverTitle,
      skillMatchPercent: skillPct,
      distanceMiles,
      cityLabel: staffCityLabel(staff.zip_code),
      matchedSkills: matched,
      note: (row.caregiver_note ?? '').trim(),
      requestedAtLabel: formatRequestedAt(row.created_at),
      proximityPercent: proximity,
      overallPercent: overallScorePercent(skillPct, proximity),
    }

    const existing = bySchedule.get(sched.id)
    if (existing) {
      existing.requests.push(card)
    } else {
      bySchedule.set(sched.id, {
        scheduleId: sched.id,
        requests: [card],
      })
    }
  }

  const visits: AssignmentVisitCardDTO[] = []
  for (const agg of Array.from(bySchedule.values())) {
    const sched = scheduleById.get(agg.scheduleId)
    const patient = sched ? patientById.get(sched.patient_id) : undefined
    if (!sched || !patient) continue

    const sortedReqs = [...agg.requests].sort((a, b) => b.overallPercent - a.overallPercent)
    if (sortedReqs.length === 0) continue

    visits.push({
      id: sched.id,
      visitTitle: visitTitleFromSchedule(sched, taskNameById),
      clientName: patient.full_name ?? 'Client',
      dateLabel: formatScheduleDate(sched.date),
      timeLabel: formatTimeRange(sched.start_time, sched.end_time),
      locationLabel: patientLocationLabel(patient),
      requests: sortedReqs,
    })
  }

  visits.sort((a, b) => {
    const sa = scheduleById.get(a.id)
    const sb = scheduleById.get(b.id)
    if (!sa || !sb) return 0
    return sa.date.localeCompare(sb.date) || formatTimePart(sa.start_time).localeCompare(formatTimePart(sb.start_time))
  })

  const resolved: ResolvedAssignmentRowDTO[] = []
  for (const row of resolvedRows) {
    const sched = scheduleById.get(row.schedule_id)
    const patient = sched ? patientById.get(sched.patient_id) : undefined
    const staff = staffById.get(row.caregiver_member_id)
    if (!sched || !patient || !staff || !row.resolved_at) continue

    const caregiverName = [staff.first_name, staff.last_name].filter(Boolean).join(' ') || 'Caregiver'
    resolved.push({
      id: row.id,
      kind: row.status === 'approved' ? 'approved' : 'declined',
      caregiverName,
      visitTitle: visitTitleFromSchedule(sched, taskNameById),
      clientName: patient.full_name ?? 'Client',
      visitDateLabel: formatScheduleDate(sched.date),
      resolvedAtLabel: formatResolvedAt(row.resolved_at),
      reason: (row.decline_reason ?? '').trim() || undefined,
    })
  }

  return { visits, resolved, approvedTotal, declinedTotal }
}

/**
 * Count of pending assignment requests shown in Visit Management (Assignment Requests tab + sidebar badge).
 * Matches {@link fetchVisitAssignmentDashboardData} filtering (unassigned visit, patient/caregiver data, proximity).
 * Do not use a raw `schedule_assignment_requests` count — it will disagree with the UI.
 */
export async function getPendingAssignmentRequestCountForBadge(
  supabase: Supabase
): Promise<{ count: number; error?: string }> {
  const data = await fetchVisitAssignmentDashboardData(supabase)
  if (data.error) return { count: 0, error: data.error }
  const count = data.visits.reduce((sum, v) => sum + v.requests.length, 0)
  return { count }
}
