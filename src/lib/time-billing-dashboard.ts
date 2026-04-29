import type { Supabase } from '@/lib/supabase/types'
import { resolvePayRateForVisit, type CaregiverPayRateRow } from '@/lib/caregiver-pay-rates'
import type { PatientServiceContractRow } from '@/lib/supabase/query/patient-service-contracts'
import {
  patientServiceContractOverlapsDate,
  sortPatientServiceContractsByRecency,
  WEEKLY_HOURS_CONTRACT_TYPE,
} from '@/lib/patient-service-contract-effective'

export type TimeBillingStatus = 'pending' | 'approved' | 'voided'

export type TimeBillingRow = {
  /** Row key = scheduled visit id. */
  id: string
  scheduledVisitId: string
  date: string
  /** `patients.id` — for filter dropdowns. */
  clientId: string
  /** `caregiver_members.id` when assigned; empty string if none. */
  caregiverId: string
  clientName: string
  caregiverName: string
  timeLabel: string
  actualHours: number
  billableHours: number
  serviceType: 'non_skilled' | 'skilled'
  payRate: number
  payAmount: number
  billRate: number
  billAmount: number
  note: string | null
  status: TimeBillingStatus
}

function toHHMM(t: string | null): string {
  if (!t) return '--:--'
  return String(t).slice(0, 5)
}

function hoursFromSchedule(start: string | null, end: string | null): number {
  if (!start || !end) return 0
  const toMinutes = (raw: string) => {
    const s = String(raw).trim()
    const parts = s.split(':').map((x) => parseInt(x, 10))
    const h = parts[0]
    const m = parts[1]
    if (!Number.isFinite(h)) return NaN
    return h * 60 + (Number.isFinite(m) ? m : 0)
  }
  const a = toMinutes(start)
  const b = toMinutes(end)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0
  return round2((b - a) / 60)
}

function calcAmount(hours: number, rate: number, unit: string | null | undefined): number {
  if (!Number.isFinite(hours) || !Number.isFinite(rate)) return 0
  if (unit === 'visit') return rate
  if (unit === '15_min_unit') return rate * Math.round(hours * 4)
  return rate * hours
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export async function fetchTimeBillingRows(supabase: Supabase): Promise<{ rows: TimeBillingRow[]; error?: string }> {
  const { data: visits, error: visitsErr } = await supabase
    .from('scheduled_visits')
    .select(
      'id, patient_id, caregiver_member_id, visit_date, scheduled_start_time, scheduled_end_time, service_type'
    )
    .eq('status', 'completed')
    .order('visit_date', { ascending: false })
  if (visitsErr) return { rows: [], error: visitsErr.message }

  const visitList = visits ?? []
  if (visitList.length === 0) return { rows: [] }

  const patientIds = Array.from(new Set(visitList.map((v) => v.patient_id)))
  const caregiverIds = Array.from(
    new Set(visitList.flatMap((v) => (v.caregiver_member_id ? [v.caregiver_member_id] : [])))
  )

  const visitIds = visitList.map((v) => v.id)
  const [patRes, cgRes, contractsRes, caregiverPayRes, financialsRes, approvalsRes, entriesRes] = await Promise.all([
    supabase.from('patients').select('id, full_name').in('id', patientIds),
    caregiverIds.length
      ? supabase.from('caregiver_members').select('id, first_name, last_name').in('id', caregiverIds)
      : Promise.resolve({ data: [], error: null } as const),
    supabase
      .from('patient_service_contracts')
      .select(
        'id, patient_id, contract_type, service_type, bill_rate, bill_unit_type, effective_date, end_date, status, created_at, updated_at'
      )
      .in('patient_id', patientIds),
    caregiverIds.length
      ? supabase
          .from('caregiver_pay_rates')
          .select('caregiver_member_id, pay_rate, unit_type, service_type, effective_start, effective_end')
          .in('caregiver_member_id', caregiverIds)
      : Promise.resolve({ data: [], error: null } as const),
    visitIds.length
      ? supabase
          .from('visit_financials')
          .select(
            'scheduled_visit_id, service_type, status, pay_rate, pay_amount, bill_rate, bill_amount, approved_billable_hours, approved_actual_hours, pay_unit_type, bill_unit_type, coordinator_note'
          )
          .in('scheduled_visit_id', visitIds)
      : Promise.resolve({ data: [], error: null } as const),
    visitIds.length
      ? supabase
          .from('visit_approvals')
          .select('scheduled_visit_id, approval_status, approved_billable_hours, approved_actual_hours, approval_comment')
          .in('scheduled_visit_id', visitIds)
      : Promise.resolve({ data: [], error: null } as const),
    visitIds.length
      ? supabase
          .from('visit_time_entries')
          .select('scheduled_visit_id, actual_hours, billable_hours, clock_in_time, clock_out_time')
          .in('scheduled_visit_id', visitIds)
      : Promise.resolve({ data: [], error: null } as const),
  ])

  if (patRes.error) return { rows: [], error: patRes.error.message }
  if (cgRes.error) return { rows: [], error: cgRes.error.message }
  if (contractsRes.error) return { rows: [], error: contractsRes.error.message }
  if (caregiverPayRes.error) return { rows: [], error: caregiverPayRes.error.message }
  if (financialsRes.error) return { rows: [], error: financialsRes.error.message }
  if (approvalsRes.error) return { rows: [], error: approvalsRes.error.message }
  if (entriesRes.error) return { rows: [], error: entriesRes.error.message }

  const patientNameById = new Map((patRes.data ?? []).map((r) => [r.id, r.full_name ?? 'Client']))
  const caregiverNameById = new Map(
    (cgRes.data ?? []).map((r) => [r.id, [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Caregiver'])
  )

  const contracts = contractsRes.data ?? []
  const caregiverPayRows = (caregiverPayRes.data ?? []) as CaregiverPayRateRow[]
  type FinancialRow = {
    scheduled_visit_id: string
    service_type?: string | null
    status?: string | null
    pay_rate: number | null
    pay_amount: number | null
    bill_rate: number | null
    bill_amount: number | null
    approved_billable_hours?: number | null
    approved_actual_hours?: number | null
    pay_unit_type?: string | null
    bill_unit_type?: string | null
    coordinator_note?: string | null
  }
  const financialByVisitId = new Map(
    ((financialsRes.data ?? []) as FinancialRow[]).map((r) => [r.scheduled_visit_id, r])
  )
  type ApprovalRow = {
    scheduled_visit_id: string
    approval_status: string | null
    approved_billable_hours?: number | null
    approved_actual_hours?: number | null
    approval_comment?: string | null
  }
  const approvalByVisitId = new Map(
    ((approvalsRes.data ?? []) as ApprovalRow[]).map((r) => [r.scheduled_visit_id, r])
  )
  type EntryRow = {
    scheduled_visit_id: string
    actual_hours?: number | null
    billable_hours?: number | null
    clock_in_time?: string | null
    clock_out_time?: string | null
  }
  const entryByVisitId = new Map(
    ((entriesRes.data ?? []) as EntryRow[]).map((r) => [r.scheduled_visit_id, r])
  )
  const pickContract = (patientId: string, serviceType: string, date: string) => {
    const rows = (contracts as PatientServiceContractRow[]).filter(
      (c) =>
        c.patient_id === patientId &&
        c.service_type === serviceType &&
        c.contract_type !== WEEKLY_HOURS_CONTRACT_TYPE &&
        patientServiceContractOverlapsDate(c, date)
    )
    if (rows.length === 0) return undefined
    return [...rows].sort(sortPatientServiceContractsByRecency)[0]
  }

  const rows: TimeBillingRow[] = visitList
    .filter((sv) => financialByVisitId.has(String(sv.id)) || approvalByVisitId.has(String(sv.id)))
    .map((sv) => {
    const date = sv.visit_date ?? ''
    const financial = financialByVisitId.get(sv.id)
    const approval = approvalByVisitId.get(sv.id)
    const serviceTypeRaw =
      (financial?.service_type ?? sv.service_type) === 'skilled' ? 'skilled' : 'non_skilled'
    const serviceType = serviceTypeRaw as 'non_skilled' | 'skilled'
    const caregiverId = sv.caregiver_member_id ?? ''
    const scheduleHours = hoursFromSchedule(sv.scheduled_start_time, sv.scheduled_end_time)
    const entry = entryByVisitId.get(sv.id)
    const finHours = financial?.approved_billable_hours != null ? Number(financial.approved_billable_hours) : NaN
    const approvalHours = approval?.approved_billable_hours != null ? Number(approval.approved_billable_hours) : NaN
    const entryBillable = entry?.billable_hours != null ? Number(entry.billable_hours) : NaN
    const fallbackBillableHours = Number.isFinite(finHours)
      ? round2(finHours)
      : Number.isFinite(approvalHours)
        ? round2(approvalHours)
        : Number.isFinite(entryBillable)
          ? round2(entryBillable)
          : scheduleHours
    const finActualHours = financial?.approved_actual_hours != null ? Number(financial.approved_actual_hours) : NaN
    const approvalActualHours = approval?.approved_actual_hours != null ? Number(approval.approved_actual_hours) : NaN
    const entryActualHours = entry?.actual_hours != null ? Number(entry.actual_hours) : NaN
    const fallbackActualHours = Number.isFinite(finActualHours)
      ? round2(finActualHours)
      : Number.isFinite(approvalActualHours)
        ? round2(approvalActualHours)
        : Number.isFinite(entryActualHours)
          ? round2(entryActualHours)
          : scheduleHours
    const status: TimeBillingStatus =
      approval?.approval_status === 'approved'
        ? 'approved'
        : financial?.status === 'voided'
          ? 'voided'
          : 'pending'

    const pay =
      caregiverId && date
        ? resolvePayRateForVisit(caregiverId, serviceType, date, caregiverPayRows)
        : null
    const contract = sv.patient_id && date ? pickContract(sv.patient_id, serviceType, date) : null
    const useFrozenFinancial = financial != null && Number.isFinite(Number(financial.bill_rate ?? NaN))

    let actualHours = fallbackActualHours
    let billableHours = fallbackBillableHours
    let payRate = Number(pay?.rate ?? 0)
    let payAmount = round2(calcAmount(actualHours, payRate, pay?.unit_type))
    let billRate = Number(contract?.bill_rate ?? 0)
    let billAmount = round2(calcAmount(billableHours, billRate, contract?.bill_unit_type))

    if (useFrozenFinancial && financial) {
      const abh = financial.approved_billable_hours != null ? Number(financial.approved_billable_hours) : NaN
      const aah = financial.approved_actual_hours != null ? Number(financial.approved_actual_hours) : NaN
      if (Number.isFinite(abh)) billableHours = round2(abh)
      if (Number.isFinite(aah)) actualHours = round2(aah)
      payRate = Number(financial.pay_rate ?? 0)
      billRate = Number(financial.bill_rate ?? 0)
      payAmount = round2(Number(financial.pay_amount ?? 0))
      billAmount = round2(Number(financial.bill_amount ?? 0))
    }

    const caregiverLabel = caregiverId
      ? caregiverNameById.get(caregiverId) ?? 'Caregiver'
      : '—'

    return {
      id: sv.id,
      scheduledVisitId: sv.id,
      date,
      clientId: sv.patient_id ?? '',
      caregiverId: caregiverId,
      clientName: patientNameById.get(sv.patient_id) ?? 'Client',
      caregiverName: caregiverLabel,
      timeLabel: `${toHHMM(sv.scheduled_start_time)} - ${toHHMM(sv.scheduled_end_time)}`,
      actualHours,
      billableHours,
      serviceType,
      payRate,
      payAmount,
      billRate,
      billAmount,
      note: approval?.approval_comment ?? financial?.coordinator_note ?? null,
      status,
    }
    })

  return { rows }
}
