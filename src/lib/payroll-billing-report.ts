import type { Supabase } from '@/lib/supabase/types'
import { resolvePayRateForVisit, type CaregiverPayRateRow, type LegacyPayRateScheduleRow } from '@/lib/caregiver-pay-rates'

export type PayrollBillingDetailRow = {
  id: string
  clientId: string
  caregiverId: string
  clientName: string
  caregiverName: string
  serviceTypeLabel: string
  visitDate: string
  startTime: string
  endTime: string
  actualHours: number
  billableHours: number
  payRate: number
  payAmount: number
  billRate: number
  billAmount: number
  /** Time & Billing workflow state for this visit row. */
  billingState: 'approved' | 'pending'
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

function serviceTypeLabel(serviceType: string, visitType: string | null | undefined): string {
  const vt = visitType?.trim()
  if (vt) return vt
  return serviceType === 'skilled' ? 'Skilled' : 'HHA/CNA'
}

/**
 * Completed visits in date range with billing_state approved or pending (Time & Billing queue).
 * Amounts use the same rate resolution as Time & Billing (rates effective on visit_date).
 */
export async function fetchPayrollBillingReportRows(
  supabase: Supabase,
  params: { agencyId: string | null; dateFrom: string; dateTo: string }
): Promise<{ rows: PayrollBillingDetailRow[]; error?: string }> {
  const { agencyId, dateFrom, dateTo } = params

  let visitQuery = supabase
    .from('scheduled_visits')
    .select(
      'id, agency_id, patient_id, caregiver_member_id, visit_date, scheduled_start_time, scheduled_end_time, service_type, visit_type, billing_hours, billing_state, billing_rate, billing_amount'
    )
    .eq('status', 'completed')
    .in('billing_state', ['approved', 'pending'])
    .gte('visit_date', dateFrom)
    .lte('visit_date', dateTo)
    .order('visit_date', { ascending: true })
    .order('scheduled_start_time', { ascending: true })

  if (agencyId) {
    visitQuery = visitQuery.eq('agency_id', agencyId)
  }

  const { data: visits, error: visitsErr } = await visitQuery
  if (visitsErr) return { rows: [], error: visitsErr.message }

  const visitList = visits ?? []
  if (visitList.length === 0) return { rows: [] }

  const patientIds = Array.from(new Set(visitList.map((v) => v.patient_id)))
  const caregiverIds = Array.from(
    new Set(visitList.flatMap((v) => (v.caregiver_member_id ? [v.caregiver_member_id] : [])))
  )

  const visitIds = visitList.map((v) => v.id as string)
  const [patRes, cgRes, contractsRes, caregiverPayRes, legacyPayRes, financialsRes] = await Promise.all([
    supabase.from('patients').select('id, full_name').in('id', patientIds),
    caregiverIds.length
      ? supabase.from('caregiver_members').select('id, first_name, last_name').in('id', caregiverIds)
      : Promise.resolve({ data: [], error: null } as const),
    supabase
      .from('patient_service_contracts')
      .select('id, patient_id, service_type, bill_rate, bill_unit_type, effective_date, end_date, status')
      .in('patient_id', patientIds),
    caregiverIds.length
      ? supabase
          .from('caregiver_pay_rates')
          .select('caregiver_member_id, pay_rate, unit_type, service_type, effective_start, effective_end')
          .in('caregiver_member_id', caregiverIds)
      : Promise.resolve({ data: [], error: null } as const),
    caregiverIds.length
      ? supabase
          .from('pay_rate_schedule')
          .select('caregiver_member_id, service_type, rate, unit_type, effective_start, effective_end, status')
          .in('caregiver_member_id', caregiverIds)
      : Promise.resolve({ data: [], error: null } as const),
    visitIds.length
      ? supabase
          .from('visit_financials')
          .select('scheduled_visit_id, pay_rate, pay_amount, bill_rate, bill_amount')
          .in('scheduled_visit_id', visitIds)
      : Promise.resolve({ data: [], error: null } as const),
  ])

  if (patRes.error) return { rows: [], error: patRes.error.message }
  if (cgRes.error) return { rows: [], error: cgRes.error.message }
  if (contractsRes.error) return { rows: [], error: contractsRes.error.message }
  if (caregiverPayRes.error) return { rows: [], error: caregiverPayRes.error.message }
  if (legacyPayRes.error) return { rows: [], error: legacyPayRes.error.message }
  if (financialsRes.error) return { rows: [], error: financialsRes.error.message }

  const patientNameById = new Map((patRes.data ?? []).map((r) => [r.id, r.full_name ?? 'Client']))
  const caregiverNameById = new Map(
    (cgRes.data ?? []).map((r) => [r.id, [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Caregiver'])
  )

  const contracts = contractsRes.data ?? []
  const caregiverPayRows = (caregiverPayRes.data ?? []) as CaregiverPayRateRow[]
  const legacyPayRows = (legacyPayRes.data ?? []) as LegacyPayRateScheduleRow[]
  type FinancialRow = {
    scheduled_visit_id: string
    pay_rate: number | null
    pay_amount: number | null
    bill_rate: number | null
    bill_amount: number | null
  }
  const financialByVisitId = new Map(
    ((financialsRes.data ?? []) as FinancialRow[]).map((r) => [r.scheduled_visit_id, r])
  )

  const pickContract = (patientId: string, serviceType: string, date: string) =>
    contracts
      .filter(
        (c) =>
          c.patient_id === patientId &&
          c.service_type === serviceType &&
          c.status === 'active' &&
          c.effective_date <= date &&
          (!c.end_date || c.end_date >= date)
      )
      .sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0]

  const rows: PayrollBillingDetailRow[] = visitList.map((sv) => {
    const visitDate = sv.visit_date ?? ''
    const serviceType = (sv.service_type === 'skilled' ? 'skilled' : 'non_skilled') as 'non_skilled' | 'skilled'
    const caregiverId = sv.caregiver_member_id ?? ''
    const scheduleHours = hoursFromSchedule(sv.scheduled_start_time, sv.scheduled_end_time)
    const bh = sv.billing_hours != null ? Number(sv.billing_hours) : NaN
    const billableHours = Number.isFinite(bh) ? round2(bh) : scheduleHours
    const actualHours = scheduleHours > 0 ? round2(scheduleHours) : billableHours

    const rawBilling = (sv as { billing_state?: string | null }).billing_state
    const billingState: 'approved' | 'pending' = rawBilling === 'approved' ? 'approved' : 'pending'

    const pay =
      caregiverId && visitDate
        ? resolvePayRateForVisit(caregiverId, serviceType, visitDate, caregiverPayRows, legacyPayRows)
        : null
    const contract = sv.patient_id && visitDate ? pickContract(sv.patient_id, serviceType, visitDate) : null
    const financial = financialByVisitId.get(sv.id as string)
    const useFrozenBill = billingState !== 'pending' && !!financial
    const frozenBillRateFromVisit = Number((sv as { billing_rate?: number | null }).billing_rate ?? NaN)
    const frozenBillAmountFromVisit = Number((sv as { billing_amount?: number | null }).billing_amount ?? NaN)
    const hasFrozenOnVisit = billingState !== 'pending' && Number.isFinite(frozenBillRateFromVisit)
    const payRate = Number(pay?.rate ?? 0)
    const billRate = hasFrozenOnVisit
      ? frozenBillRateFromVisit
      : useFrozenBill
        ? Number(financial?.bill_rate ?? 0)
        : Number(contract?.bill_rate ?? 0)
    const payAmount = round2(calcAmount(billableHours, payRate, pay?.unit_type))
    const billAmount = hasFrozenOnVisit
      ? (Number.isFinite(frozenBillAmountFromVisit)
          ? frozenBillAmountFromVisit
          : round2(calcAmount(billableHours, billRate, contract?.bill_unit_type)))
      : useFrozenBill
        ? Number(financial?.bill_amount ?? 0)
        : round2(calcAmount(billableHours, billRate, contract?.bill_unit_type))

    const vt = (sv as { visit_type?: string | null }).visit_type

    return {
      id: sv.id as string,
      clientId: sv.patient_id as string,
      caregiverId,
      clientName: patientNameById.get(sv.patient_id) ?? 'Client',
      caregiverName: caregiverId ? caregiverNameById.get(caregiverId) ?? 'Caregiver' : '—',
      serviceTypeLabel: serviceTypeLabel(serviceType, vt ?? null),
      visitDate,
      startTime: toHHMM(sv.scheduled_start_time),
      endTime: toHHMM(sv.scheduled_end_time),
      actualHours: actualHours,
      billableHours,
      payRate,
      payAmount,
      billRate,
      billAmount,
      billingState,
    }
  })

  return { rows }
}
