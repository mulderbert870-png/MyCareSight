import type { Supabase } from '@/lib/supabase/types'

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
  hours: number
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

function billingStatusFromVisit(billingState: string | null | undefined): TimeBillingStatus {
  if (billingState === 'approved') return 'approved'
  if (billingState === 'voided') return 'voided'
  return 'pending'
}

export async function fetchTimeBillingRows(supabase: Supabase): Promise<{ rows: TimeBillingRow[]; error?: string }> {
  const { data: visits, error: visitsErr } = await supabase
    .from('scheduled_visits')
    .select(
      'id, patient_id, caregiver_member_id, visit_date, scheduled_start_time, scheduled_end_time, service_type, billing_state, billing_hours, billing_note'
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

  const rows: TimeBillingRow[] = visitList.map((sv) => {
    const date = sv.visit_date ?? ''
    const serviceType = (sv.service_type === 'skilled' ? 'skilled' : 'non_skilled') as 'non_skilled' | 'skilled'
    const caregiverId = sv.caregiver_member_id ?? ''
    const scheduleHours = hoursFromSchedule(sv.scheduled_start_time, sv.scheduled_end_time)
    const bh = sv.billing_hours != null ? Number(sv.billing_hours) : NaN
    const hours = Number.isFinite(bh) ? round2(bh) : scheduleHours

    const pay = caregiverId && date ? pickPayRate(caregiverId, serviceType, date) : null
    const contract = sv.patient_id && date ? pickContract(sv.patient_id, serviceType, date) : null
    const payRate = Number(pay?.rate ?? 0)
    const billRate = Number(contract?.bill_rate ?? 0)
    const payAmount = round2(calcAmount(hours, payRate, pay?.unit_type))
    const billAmount = round2(calcAmount(hours, billRate, contract?.bill_unit_type))

    const status: TimeBillingStatus = billingStatusFromVisit(
      (sv as { billing_state?: string | null }).billing_state
    )

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
      hours,
      serviceType,
      payRate,
      payAmount,
      billRate,
      billAmount,
      note: (sv as { billing_note?: string | null }).billing_note ?? null,
      status,
    }
  })

  return { rows }
}
