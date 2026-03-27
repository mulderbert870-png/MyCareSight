import zipcodes from 'zipcodes'
import type { Supabase } from '@/lib/supabase/types'
import * as q from '@/lib/supabase/query'
import type { ScheduleRow } from '@/lib/supabase/query/schedules'
import { overallScorePercent, proximityPercentFromMiles } from '@/lib/visit-assignment-scoring'

export type VisitStatus = 'completed' | 'missed' | 'in_progress' | 'scheduled' | 'unassigned'

export type ReassignCandidateDTO = {
  id: string
  caregiverName: string
  caregiverTitle: string
  distanceMiles: number
  skillMatchPercent: number
  proximityPercent: number
  overallPercent: number
  matchedSkills: string[]
  isCurrent: boolean
}

export type AllVisitCardDTO = {
  id: string
  date: string
  dateLabel: string
  timeLabel: string
  visitTitle: string
  status: VisitStatus
  statusLabel: string
  typeLabel: string
  clientId: string
  clientName: string
  locationLabel: string
  caregiverId: string | null
  caregiverName: string | null
  adlTasks: string[]
  notes: string | null
  clientRequiredSkills: string[]
  reassignCandidates: ReassignCandidateDTO[]
}

export type AllVisitsDashboardDTO = {
  allVisits: AllVisitCardDTO[]
  allClients: Array<{ id: string; name: string }>
  allCaregivers: Array<{ id: string; name: string }>
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
  role?: string | null
  job_title?: string | null
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
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function formatTimePart(t: string | null | undefined): string {
  if (!t) return ''
  return String(t).slice(0, 5)
}

function formatTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  const a = formatTimePart(start)
  const b = formatTimePart(end)
  if (a && b) return `${a} - ${b}`
  return a || b || '-'
}

function visitTitleFromSchedule(s: ScheduleRow): string {
  const t = (s.type ?? '').trim()
  if (t) return t
  const d = (s.description ?? '').trim()
  if (d) return d.length > 80 ? `${d.slice(0, 77)}...` : d
  return 'Care visit'
}

function patientLocationLabel(patient: PatientRow): string {
  const z = normalizeUsZipForLookup(patient.zip_code)
  if (z) {
    const loc = zipcodes.lookup(z)
    if (loc?.city && loc?.state) return `${loc.city}, ${loc.state}`
  }
  if (patient.city && patient.state) return `${patient.city}, ${patient.state}`
  if (patient.state) return String(patient.state)
  if (patient.street_address) return String(patient.street_address).split(',')[0]?.trim() || '-'
  return '-'
}

function decodeAdlCodes(codes: string[] | null | undefined): string[] {
  if (!Array.isArray(codes)) return []
  return codes
    .map((code) => {
      const v = String(code || '').trim()
      if (!v) return ''
      const parts = v.split('::')
      return (parts.length > 1 ? parts[1] : parts[0]).trim()
    })
    .filter(Boolean)
}

function deriveVisitStatus(s: ScheduleRow): VisitStatus {
  const raw = (s.status ?? '').toLowerCase().trim()
  if (raw === 'completed') return 'completed'
  if (raw === 'missed') return 'missed'
  if (raw === 'in_progress' || raw === 'in progress') return 'in_progress'

  const now = new Date()
  const start = s.start_time ? new Date(`${s.date}T${formatTimePart(s.start_time)}:00`) : null
  const end = s.end_time ? new Date(`${s.date}T${formatTimePart(s.end_time)}:00`) : null
  const dayStart = new Date(`${s.date}T00:00:00`)
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)

  // If current time is within the scheduled window, show in progress.
  if (start && end && now >= start && now <= end) return 'in_progress'

  // Any schedule in the past: unassigned becomes missed, assigned becomes completed
  // (unless explicitly marked missed above).
  if (end) {
    if (end < now) return s.caregiver_id ? 'completed' : 'missed'
  } else if (dayStart < todayStart) {
    return s.caregiver_id ? 'completed' : 'missed'
  }

  if (!s.caregiver_id) return 'unassigned'
  return 'scheduled'
}

function statusLabel(v: VisitStatus): string {
  if (v === 'in_progress') return 'In Progress'
  if (v === 'unassigned') return 'Unassigned'
  return v.charAt(0).toUpperCase() + v.slice(1)
}

function typeLabel(s: ScheduleRow): string {
  const t = (s.type ?? '').trim()
  return t || 'Routine'
}

function skillMatchForStaff(requiredSkills: string[], caregiverSkills: string[]): { percent: number; matched: string[] } {
  const requiredLen = requiredSkills.length
  if (requiredLen === 0) return { percent: 100, matched: [] }
  const matched = requiredSkills.filter((sk) => caregiverSkills.includes(sk))
  return { percent: Math.round((matched.length / requiredLen) * 100), matched }
}

export async function fetchAllVisitsDashboardData(supabase: Supabase): Promise<AllVisitsDashboardDTO> {
  const [{ data: schedulesData }, { data: allPatientsData }, { data: allStaffDataAll }] = await Promise.all([
    supabase
      .from('schedules')
      .select('*')
      .order('date', { ascending: false })
      .order('start_time', { ascending: true }),
    supabase.from('patients').select('id, full_name').order('full_name', { ascending: true }),
    supabase.from('staff_members').select('id, first_name, last_name').order('first_name', { ascending: true }),
  ])

  const schedules = (schedulesData ?? []) as ScheduleRow[]
  const allClients = ((allPatientsData ?? []) as Array<{ id: string; full_name?: string | null }>).map((p) => ({
    id: p.id,
    name: p.full_name?.trim() || 'Client',
  }))
  const allCaregivers = ((allStaffDataAll ?? []) as Array<{ id: string; first_name?: string | null; last_name?: string | null }>).map((s) => ({
    id: s.id,
    name: [s.first_name, s.last_name].filter(Boolean).join(' ') || 'Caregiver',
  }))
  if (schedules.length === 0) return { allVisits: [], allClients, allCaregivers }

  const patientIds = Array.from(new Set(schedules.map((s) => s.patient_id)))
  const [{ data: patientsData }, { data: allStaffData }, { data: reqRows }] = await Promise.all([
    supabase.from('patients').select('id, full_name, zip_code, state, city, street_address').in('id', patientIds),
    supabase.from('staff_members').select('id, first_name, last_name, zip_code, skills, role, job_title'),
    q.getCaregiverRequirementsByPatientIds(supabase, patientIds),
  ])

  const patientById = new Map(((patientsData ?? []) as PatientRow[]).map((p) => [p.id, p]))
  const allStaff = (allStaffData ?? []) as StaffRow[]
  const staffById = new Map(allStaff.map((s) => [s.id, s]))

  const requirementsByPatient = new Map<string, string[]>()
  for (const row of reqRows ?? []) {
    const pr = row as { patient_id?: string; skill_codes?: string[] }
    if (pr.patient_id && Array.isArray(pr.skill_codes)) requirementsByPatient.set(pr.patient_id, pr.skill_codes)
  }

  const allVisits: AllVisitCardDTO[] = schedules.map((s) => {
    const patient = patientById.get(s.patient_id)
    const currentCaregiver = s.caregiver_id ? staffById.get(s.caregiver_id) : undefined
    const requiredSkills = requirementsByPatient.get(s.patient_id) ?? []
    const clientZip = normalizeUsZipForLookup(patient?.zip_code)

    const candidates: ReassignCandidateDTO[] = allStaff
      .map((staff) => {
        const staffZip = normalizeUsZipForLookup(staff.zip_code)
        let distanceMiles = Number.POSITIVE_INFINITY
        if (clientZip && staffZip) {
          const d = zipcodes.distance(clientZip, staffZip)
          if (d != null && Number.isFinite(d)) distanceMiles = d
        }
        const proximity = proximityPercentFromMiles(distanceMiles)
        if (proximity === null) return null

        const caregiverSkills = Array.isArray(staff.skills) ? staff.skills : []
        const { percent: skillPct, matched } = skillMatchForStaff(requiredSkills, caregiverSkills)
        return {
          id: staff.id,
          caregiverName: [staff.first_name, staff.last_name].filter(Boolean).join(' ') || 'Caregiver',
          caregiverTitle: (staff.job_title && staff.job_title.trim()) || (staff.role && String(staff.role).trim()) || 'Caregiver',
          distanceMiles,
          skillMatchPercent: skillPct,
          proximityPercent: proximity,
          overallPercent: overallScorePercent(skillPct, proximity),
          matchedSkills: matched,
          isCurrent: s.caregiver_id === staff.id,
        }
      })
      .filter((v): v is ReassignCandidateDTO => v !== null)
      .sort((a, b) => b.overallPercent - a.overallPercent)

    const status = deriveVisitStatus(s)
    return {
      id: s.id,
      date: s.date,
      dateLabel: formatScheduleDate(s.date),
      timeLabel: formatTimeRange(s.start_time, s.end_time),
      visitTitle: visitTitleFromSchedule(s),
      status,
      statusLabel: statusLabel(status),
      typeLabel: typeLabel(s),
      clientId: s.patient_id,
      clientName: patient?.full_name ?? 'Client',
      locationLabel: patient ? patientLocationLabel(patient) : '-',
      caregiverId: s.caregiver_id,
      caregiverName: currentCaregiver ? [currentCaregiver.first_name, currentCaregiver.last_name].filter(Boolean).join(' ') : null,
      adlTasks: decodeAdlCodes(s.adl_codes),
      notes: s.notes,
      clientRequiredSkills: requiredSkills,
      reassignCandidates: candidates,
    }
  })

  return { allVisits, allClients, allCaregivers }
}
