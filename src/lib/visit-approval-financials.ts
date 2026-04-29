/**
 * Persists coordinator Time & Billing decisions to visit_approvals, visit_financials,
 * and visit_adjustment_history (audit trail). Reports should read frozen rows from visit_financials.
 */

import type { Supabase } from '@/lib/supabase/types'
import {
  resolvePayRateForVisit,
  type CaregiverPayRateRow,
} from '@/lib/caregiver-pay-rates'

export type VisitRowForBillingApproval = {
  id: string
  agency_id: string
  patient_id: string
  caregiver_member_id: string | null
  visit_date: string
  scheduled_start_time?: string | null
  scheduled_end_time?: string | null
}

type ContractPick = {
  id: string
  bill_rate: number | null
  bill_unit_type: string | null
  billing_code_id?: string | null
} | null

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function calcAmount(hours: number, rate: number, unit: string | null | undefined): number {
  if (!Number.isFinite(hours) || !Number.isFinite(rate)) return 0
  if (unit === 'visit') return rate
  if (unit === '15_min_unit') return rate * Math.round(hours * 4)
  return rate * hours
}

function hoursFromSchedule(start: string | null | undefined, end: string | null | undefined): number {
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

async function loadFirstTaskIdForVisit(supabase: Supabase, visitId: string): Promise<string | null> {
  const { data } = await supabase
    .from('scheduled_visit_tasks')
    .select('task_id')
    .eq('scheduled_visit_id', visitId)
    .not('task_id', 'is', null)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle()
  const tid = (data as { task_id?: string | null } | null)?.task_id
  return tid?.trim() || null
}

export async function ensureVisitTimeEntryForBilling(
  supabase: Supabase,
  visit: VisitRowForBillingApproval
): Promise<{ id: string } | { error: string }> {
  if (!visit.caregiver_member_id) return { error: 'Visit has no assigned caregiver.' }

  const { data: existing, error: selErr } = await supabase
    .from('visit_time_entries')
    .select('id')
    .eq('scheduled_visit_id', visit.id)
    .maybeSingle()
  if (selErr) return { error: selErr.message }
  if (existing?.id) return { id: String(existing.id) }

  const { data: inserted, error: insErr } = await supabase
    .from('visit_time_entries')
    .insert({
      agency_id: visit.agency_id,
      scheduled_visit_id: visit.id,
      patient_id: visit.patient_id,
      caregiver_member_id: visit.caregiver_member_id,
      entry_status: 'submitted',
    })
    .select('id')
    .single()

  if (insErr || !inserted) return { error: insErr?.message ?? 'Could not create visit time entry.' }
  return { id: String((inserted as { id: string }).id) }
}

async function loadPayContext(
  supabase: Supabase,
  visit: VisitRowForBillingApproval,
  caregiverMemberId: string
): Promise<{
  caregiverPayRows: CaregiverPayRateRow[]
  taskId: string | null
}> {
  const [payRes, taskId] = await Promise.all([
    supabase
      .from('caregiver_pay_rates')
      .select('caregiver_member_id, pay_rate, unit_type, service_type, effective_start, effective_end')
      .eq('caregiver_member_id', caregiverMemberId),
    loadFirstTaskIdForVisit(supabase, visit.id),
  ])
  return {
    caregiverPayRows: (payRes.data ?? []) as CaregiverPayRateRow[],
    taskId,
  }
}

export async function syncVisitApprovalAndFinancialsOnApprove(params: {
  supabase: Supabase
  approvedByUserId: string
  visit: VisitRowForBillingApproval
  actualHours: number
  billableHours: number
  serviceType: 'non_skilled' | 'skilled'
  contract: ContractPick
  note: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, approvedByUserId, visit, actualHours, billableHours, serviceType, contract, note } = params
  const approvedActualHours = round2(actualHours)
  const approvedBillableHours = round2(billableHours)

  const vte = await ensureVisitTimeEntryForBilling(supabase, visit)
  if ('error' in vte) return { ok: false, error: vte.error }
  const vteId = vte.id

  const { caregiverPayRows, taskId } = await loadPayContext(
    supabase,
    visit,
    visit.caregiver_member_id!
  )
  const pay = resolvePayRateForVisit(
    visit.caregiver_member_id!,
    serviceType,
    visit.visit_date,
    caregiverPayRows
  )
  const payRate = Number(pay?.rate ?? 0)
  const payUnit = (pay?.unit_type as string | null) ?? 'hour'
  const payAmount = round2(calcAmount(approvedActualHours, payRate, payUnit))

  const billRate = Number(contract?.bill_rate ?? 0)
  const billUnit = String(contract?.bill_unit_type ?? 'hour')
  const billAmount = round2(calcAmount(approvedBillableHours, billRate, billUnit))

  const { data: prevFin } = await supabase
    .from('visit_financials')
    .select(
      'approved_billable_hours, pay_amount, bill_amount, pay_rate, bill_rate, approved_actual_hours'
    )
    .eq('scheduled_visit_id', visit.id)
    .maybeSingle()

  const prev = prevFin as {
    approved_billable_hours?: number | null
    pay_amount?: number | null
    bill_amount?: number | null
    pay_rate?: number | null
    bill_rate?: number | null
    approved_actual_hours?: number | null
  } | null

  const materiallyChanged =
    prev != null &&
    (round2(Number(prev.approved_billable_hours ?? 0)) !== approvedBillableHours ||
      round2(Number(prev.approved_actual_hours ?? 0)) !== approvedActualHours ||
      round2(Number(prev.pay_amount ?? 0)) !== payAmount ||
      round2(Number(prev.bill_amount ?? 0)) !== billAmount)

  const snapshot = {
    previous: {
      approved_billable_hours: prev?.approved_billable_hours ?? null,
      approved_actual_hours: prev?.approved_actual_hours ?? null,
      pay_rate: prev?.pay_rate ?? null,
      pay_amount: prev?.pay_amount ?? null,
      bill_rate: prev?.bill_rate ?? null,
      bill_amount: prev?.bill_amount ?? null,
    },
    new: {
      approved_billable_hours: approvedBillableHours,
      approved_actual_hours: approvedActualHours,
      pay_rate: payRate,
      pay_amount: payAmount,
      bill_rate: billRate,
      bill_amount: billAmount,
    },
    materially_changed: materiallyChanged,
    coordinator_note: note,
  }
  const { error: histErr } = await supabase.from('visit_adjustment_history').insert({
    agency_id: visit.agency_id,
    visit_time_entry_id: vteId,
    changed_by_user_id: approvedByUserId,
    reason: prev ? 'coordinator_time_billing_update' : 'coordinator_time_billing_initial',
    comment: JSON.stringify(snapshot),
  })
  if (histErr) return { ok: false, error: histErr.message }

  const { data: existingApproval, error: apprSelErr } = await supabase
    .from('visit_approvals')
    .select('id')
    .eq('visit_time_entry_id', vteId)
    .maybeSingle()
  if (apprSelErr) return { ok: false, error: apprSelErr.message }

  const approvalBase = {
    agency_id: visit.agency_id,
    scheduled_visit_id: visit.id,
    visit_time_entry_id: vteId,
    patient_id: visit.patient_id,
    caregiver_member_id: visit.caregiver_member_id!,
    approved_by_user_id: approvedByUserId,
    approval_status: 'approved' as const,
    approved_actual_hours: approvedActualHours,
    approved_billable_hours: approvedBillableHours,
    approval_comment: note,
    approved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (existingApproval?.id) {
    const { error: apprUpdErr } = await supabase
      .from('visit_approvals')
      .update(approvalBase)
      .eq('id', existingApproval.id as string)
    if (apprUpdErr) return { ok: false, error: apprUpdErr.message }
  } else {
    const { error: apprInsErr } = await supabase.from('visit_approvals').insert(approvalBase)
    if (apprInsErr) return { ok: false, error: apprInsErr.message }
  }

  const { data: apprRow, error: apprFetchErr } = await supabase
    .from('visit_approvals')
    .select('id')
    .eq('visit_time_entry_id', vteId)
    .single()
  if (apprFetchErr || !apprRow) return { ok: false, error: apprFetchErr?.message ?? 'Approval row missing.' }

  const calculation_basis = {
    approved_at: approvalBase.approved_at,
    pay_resolution: pay
      ? { source: pay.source, rate: payRate, unit_type: payUnit }
      : { source: null as string | null },
    bill_contract_id: contract?.id ?? null,
    bill_unit_type: billUnit,
    task_id: taskId,
  }

  const financialRow = {
    agency_id: visit.agency_id,
    scheduled_visit_id: visit.id,
    visit_time_entry_id: vteId,
    visit_approval_id: apprRow.id as string,
    patient_id: visit.patient_id,
    caregiver_member_id: visit.caregiver_member_id!,
    service_type: serviceType,
    status: 'approved' as const,
    coordinator_note: note,
    contract_id: contract?.id ?? null,
    billing_code_id: contract?.billing_code_id ?? null,
    pay_rate: payRate,
    pay_unit_type: payUnit,
    pay_amount: payAmount,
    bill_rate: billRate,
    bill_unit_type: billUnit,
    bill_amount: billAmount,
    approved_actual_hours: approvedActualHours,
    approved_billable_hours: approvedBillableHours,
    calculation_basis,
    updated_at: new Date().toISOString(),
  }

  const { error: finErr } = await supabase.from('visit_financials').upsert(financialRow, {
    onConflict: 'scheduled_visit_id',
  })
  if (finErr) return { ok: false, error: finErr.message }

  const { error: vteUpdErr } = await supabase
    .from('visit_time_entries')
    .update({
      actual_hours: approvedActualHours,
      billable_hours: approvedBillableHours,
      entry_status: 'approved',
      adjustment_comment: note,
      updated_at: new Date().toISOString(),
    })
    .eq('id', vteId)
  if (vteUpdErr) return { ok: false, error: vteUpdErr.message }

  return { ok: true }
}

export async function clearVisitApprovalAndFinancialsOnVoid(params: {
  supabase: Supabase
  voidedByUserId: string
  visit: VisitRowForBillingApproval
  note: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, voidedByUserId, visit, note } = params

  const vte = await ensureVisitTimeEntryForBilling(supabase, visit)
  if ('error' in vte) return { ok: false, error: vte.error }
  const vteId = vte.id

  const { data: prevFin } = await supabase
    .from('visit_financials')
    .select('pay_amount, bill_amount, approved_billable_hours')
    .eq('scheduled_visit_id', visit.id)
    .maybeSingle()

  const { error: histErr } = await supabase.from('visit_adjustment_history').insert({
    agency_id: visit.agency_id,
    visit_time_entry_id: vteId,
    changed_by_user_id: voidedByUserId,
    reason: 'coordinator_void_billing',
    comment: JSON.stringify({
      previous: prevFin ?? null,
      coordinator_note: note,
    }),
  })
  if (histErr) return { ok: false, error: histErr.message }

  const nowIso = new Date().toISOString()
  const { data: existingFin } = await supabase
    .from('visit_financials')
    .select(
      'pay_rate, pay_amount, bill_rate, bill_amount, approved_actual_hours, approved_billable_hours, service_type'
    )
    .eq('scheduled_visit_id', visit.id)
    .maybeSingle()
  const finBase = existingFin as {
    pay_rate?: number | null
    pay_amount?: number | null
    bill_rate?: number | null
    bill_amount?: number | null
    approved_actual_hours?: number | null
    approved_billable_hours?: number | null
    service_type?: string | null
  } | null

  const { error: finErr } = await supabase.from('visit_financials').upsert(
    {
      agency_id: visit.agency_id,
      scheduled_visit_id: visit.id,
      visit_time_entry_id: vteId,
      patient_id: visit.patient_id,
      caregiver_member_id: visit.caregiver_member_id!,
      status: 'voided',
      service_type: finBase?.service_type ?? 'non_skilled',
      coordinator_note: note,
      pay_rate: Number(finBase?.pay_rate ?? 0),
      pay_amount: Number(finBase?.pay_amount ?? 0),
      bill_rate: Number(finBase?.bill_rate ?? 0),
      bill_amount: Number(finBase?.bill_amount ?? 0),
      approved_actual_hours: Number(finBase?.approved_actual_hours ?? 0),
      approved_billable_hours: Number(finBase?.approved_billable_hours ?? 0),
      visit_approval_id: null,
      calculation_basis: { voided: true, at: nowIso },
      updated_at: nowIso,
    },
    { onConflict: 'scheduled_visit_id' }
  )
  if (finErr) return { ok: false, error: finErr.message }

  const { data: appr } = await supabase.from('visit_approvals').select('id').eq('visit_time_entry_id', vteId).maybeSingle()
  if (appr?.id) {
    const { error: apprErr } = await supabase
      .from('visit_approvals')
      .update({
        approval_status: 'rejected',
        approval_comment: note?.trim() ? `Voided: ${note.trim()}` : 'Voided for billing.',
        approved_at: new Date().toISOString(),
        approved_by_user_id: voidedByUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', appr.id as string)
    if (apprErr) return { ok: false, error: apprErr.message }
  }

  await supabase
    .from('visit_time_entries')
    .update({
      entry_status: 'pending_review',
      updated_at: new Date().toISOString(),
    })
    .eq('id', vteId)

  return { ok: true }
}
