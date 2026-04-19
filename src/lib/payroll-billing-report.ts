import type { Supabase } from '@/lib/supabase/types'

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
 * Approved, completed visits in date range for payroll/billing reports.
 * Amounts use the same rate resolution as Time & Billing (rates effective on visit_date).
 */
export async function fetchPayrollBillingApprovedRows(
  supabase: Supabase,
  params: { agencyId: string | null; dateFrom: string; dateTo: string }
): Promise<{ rows: PayrollBillingDetailRow[]; error?: string }> {
  const { agencyId, dateFrom, dateTo } = params

  let visitQuery = supabase
    .from('scheduled_visits')
    .select(
      'id, agency_id, patient_id, caregiver_member_id, visit_date, scheduled_start_time, scheduled_end_time, service_type, visit_type, billing_hours'
    )
    .eq('status', 'completed')
    .eq('billing_state', 'approved')
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

  const [patRes, cgRes, contractsRes, payRatesRes] = await Promise.all([
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
          .from('pay_rate_schedule')
          .select('id, caregiver_member_id, service_type, rate, unit_type, effective_start, effective_end, status')
          .in('caregiver_member_id', caregiverIds)
      : Promise.resolve({ data: [], error: null } as const),
  ])

  if (patRes.error) return { rows: [], error: patRes.error.message }
  if (cgRes.error) return { rows: [], error: cgRes.error.message }
  if (contractsRes.error) return { rows: [], error: contractsRes.error.message }
  if (payRatesRes.error) return { rows: [], error: payRatesRes.error.message }

  const patientNameById = new Map((patRes.data ?? []).map((r) => [r.id, r.full_name ?? 'Client']))
  const caregiverNameById = new Map(
    (cgRes.data ?? []).map((r) => [r.id, [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Caregiver'])
  )

  const contracts = contractsRes.data ?? []
  const payRates = payRatesRes.data ?? []

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

  const pickPayRate = (caregiverId: string, serviceType: string, date: string) =>
    payRates
      .filter(
        (r) =>
          r.caregiver_member_id === caregiverId &&
          (r.service_type == null || r.service_type === serviceType) &&
          r.status === 'active' &&
          r.effective_start <= date &&
          (!r.effective_end || r.effective_end >= date)
      )
      .sort((a, b) => b.effective_start.localeCompare(a.effective_start))[0]

  const rows: PayrollBillingDetailRow[] = visitList.map((sv) => {
    const visitDate = sv.visit_date ?? ''
    const serviceType = (sv.service_type === 'skilled' ? 'skilled' : 'non_skilled') as 'non_skilled' | 'skilled'
    const caregiverId = sv.caregiver_member_id ?? ''
    const scheduleHours = hoursFromSchedule(sv.scheduled_start_time, sv.scheduled_end_time)
    const bh = sv.billing_hours != null ? Number(sv.billing_hours) : NaN
    const billableHours = Number.isFinite(bh) ? round2(bh) : scheduleHours
    const actualHours = scheduleHours > 0 ? round2(scheduleHours) : billableHours

    const pay = caregiverId && visitDate ? pickPayRate(caregiverId, serviceType, visitDate) : null
    const contract = sv.patient_id && visitDate ? pickContract(sv.patient_id, serviceType, visitDate) : null
    const payRate = Number(pay?.rate ?? 0)
    const billRate = Number(contract?.bill_rate ?? 0)
    const payAmount = round2(calcAmount(billableHours, payRate, pay?.unit_type))
    const billAmount = round2(calcAmount(billableHours, billRate, contract?.bill_unit_type))

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
    }
  })

  return { rows }
}
