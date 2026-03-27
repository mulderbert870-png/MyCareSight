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

function visitTitleFromSchedule(s: ScheduleRow): string {
  const t = (s.type ?? '').trim()
  if (t) return t
  const d = (s.description ?? '').trim()
  if (d) return d.length > 80 ? `${d.slice(0, 77)}…` : d
  return 'Care visit'
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
  /** Staff role label stored on the row (not a FK to staff_roles in this schema). */
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

  const scheduleIds = Array.from(new Set(pendingRows.map((r) => r.schedule_id)))
  const resolvedScheduleIds = Array.from(new Set(resolvedRows.map((r) => r.schedule_id)))

  if (scheduleIds.length === 0 && resolvedScheduleIds.length === 0) {
    return { visits: [], resolved: [], approvedTotal, declinedTotal }
  }

  const allScheduleIds = Array.from(new Set(scheduleIds.concat(resolvedScheduleIds)))

  const { data: schedulesData, error: schedErr } = await supabase
    .from('schedules')
    .select('*')
    .in('id', allScheduleIds)

  if (schedErr) {
    return { visits: [], resolved: [], approvedTotal, declinedTotal, error: schedErr.message }
  }

  const schedules = (schedulesData ?? []) as ScheduleRow[]
  const scheduleById = new Map(schedules.map((s) => [s.id, s]))

  const patientIds = Array.from(new Set(schedules.map((s) => s.patient_id)))
  const staffIds = new Set<string>()
  pendingRows.forEach((r) => staffIds.add(r.staff_member_id))
  resolvedRows.forEach((r) => staffIds.add(r.staff_member_id))

  const { data: patientsData, error: patErr } = await supabase
    .from('patients')
    .select('id, full_name, zip_code, state, city, street_address')
    .in('id', patientIds)

  if (patErr) {
    return { visits: [], resolved: [], approvedTotal, declinedTotal, error: patErr.message }
  }

  const { data: staffData, error: staffErr } = await supabase
    .from('staff_members')
    .select('id, first_name, last_name, zip_code, skills, role, job_title')
    .in('id', Array.from(staffIds))

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
    const staff = staffById.get(row.staff_member_id)
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
      visitTitle: visitTitleFromSchedule(sched),
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
    const staff = staffById.get(row.staff_member_id)
    if (!sched || !patient || !staff || !row.resolved_at) continue

    const caregiverName = [staff.first_name, staff.last_name].filter(Boolean).join(' ') || 'Caregiver'
    resolved.push({
      id: row.id,
      kind: row.status === 'approved' ? 'approved' : 'declined',
      caregiverName,
      visitTitle: visitTitleFromSchedule(sched),
      clientName: patient.full_name ?? 'Client',
      visitDateLabel: formatScheduleDate(sched.date),
      resolvedAtLabel: formatResolvedAt(row.resolved_at),
      reason: (row.decline_reason ?? '').trim() || undefined,
    })
  }

  return { visits, resolved, approvedTotal, declinedTotal }
}
