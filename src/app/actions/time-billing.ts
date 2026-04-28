'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { Supabase } from '@/lib/supabase/types'
import {
  clearVisitApprovalAndFinancialsOnVoid,
  syncVisitApprovalAndFinancialsOnApprove,
} from '@/lib/visit-approval-financials'

const PATH = '/pages/agency/time-billing'
const REPORT_PAYROLL_PATH = '/pages/agency/reports/payroll-billing'

type PendingPayload = {
  scheduledVisitId: string
  hours: number
  note: string
  serviceType: 'non_skilled' | 'skilled'
}

async function applyTimeBillingVisitUpdate(
  supabase: Supabase,
  userId: string | null,
  input: PendingPayload,
  billingState: 'approved' | 'voided'
): Promise<{ ok: true } | { ok: false; error: string }> {
  const hours = Number(input.hours)
  if (!Number.isFinite(hours) || hours < 0) {
    return { ok: false, error: 'Hours must be a valid number.' }
  }

  const { data: sv, error: svErr } = await supabase
    .from('scheduled_visits')
    .select(
      'id, agency_id, caregiver_member_id, patient_id, visit_date, scheduled_start_time, scheduled_end_time'
    )
    .eq('id', input.scheduledVisitId)
    .single()

  if (svErr || !sv) {
    return { ok: false, error: svErr?.message || 'Visit not found.' }
  }

  const visit = sv as {
    id: string
    agency_id: string
    caregiver_member_id: string | null
    patient_id: string
    visit_date: string
    scheduled_start_time?: string | null
    scheduled_end_time?: string | null
  }

  if (!visit.caregiver_member_id) {
    return {
      ok: false,
      error: 'This visit has no assigned caregiver. Assign a caregiver before approving hours.',
    }
  }

  const note = input.note?.trim() ? input.note.trim() : null
  const visitDate = String(visit.visit_date ?? '')

  const { data: contract } = await supabase
    .from('patient_service_contracts')
    .select('id, bill_rate, bill_unit_type, billing_code_id, effective_date, end_date, status')
    .eq('patient_id', visit.patient_id)
    .eq('service_type', input.serviceType)
    .eq('status', 'active')
    .lte('effective_date', visitDate)
    .or(`end_date.is.null,end_date.gte.${visitDate}`)
    .order('effective_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  const frozenBillRate = Number(contract?.bill_rate ?? 0)
  const frozenBillAmount = (() => {
    const unit = String(contract?.bill_unit_type ?? 'hour')
    if (unit === 'visit') return frozenBillRate
    if (unit === '15_min_unit') return frozenBillRate * Math.round(hours * 4)
    return frozenBillRate * hours
  })()

  if (billingState === 'approved') {
    if (!userId) {
      return { ok: false, error: 'You must be signed in to approve hours.' }
    }
    const sync = await syncVisitApprovalAndFinancialsOnApprove({
      supabase,
      approvedByUserId: userId,
      visit: {
        id: visit.id,
        agency_id: visit.agency_id,
        patient_id: visit.patient_id,
        caregiver_member_id: visit.caregiver_member_id,
        visit_date: visit.visit_date,
        scheduled_start_time: visit.scheduled_start_time,
        scheduled_end_time: visit.scheduled_end_time,
      },
      billableHours: hours,
      serviceType: input.serviceType,
      contract: contract
        ? {
            id: String(contract.id),
            bill_rate: contract.bill_rate != null ? Number(contract.bill_rate) : null,
            bill_unit_type: contract.bill_unit_type != null ? String(contract.bill_unit_type) : null,
            billing_code_id: (contract as { billing_code_id?: string | null }).billing_code_id ?? null,
          }
        : null,
      note,
    })
    if (!sync.ok) return sync
  }

  if (billingState === 'voided' && userId) {
    const cleared = await clearVisitApprovalAndFinancialsOnVoid({
      supabase,
      voidedByUserId: userId,
      visit: {
        id: visit.id,
        agency_id: visit.agency_id,
        patient_id: visit.patient_id,
        caregiver_member_id: visit.caregiver_member_id,
        visit_date: visit.visit_date,
        scheduled_start_time: visit.scheduled_start_time,
        scheduled_end_time: visit.scheduled_end_time,
      },
      note,
    })
    if (!cleared.ok) return cleared
  }

  const { error: billErr } = await supabase
    .from('scheduled_visits')
    .update({
      service_type: input.serviceType,
      billing_state: billingState,
      billing_hours: hours,
      billing_note: note,
      billing_rate: Number.isFinite(frozenBillRate) ? frozenBillRate : 0,
      billing_amount: Number.isFinite(frozenBillAmount) ? Math.round((frozenBillAmount + Number.EPSILON) * 100) / 100 : 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.scheduledVisitId)
    .eq('status', 'completed')

  if (billErr) {
    return { ok: false, error: billErr.message || 'Could not update billing on visit.' }
  }

  return { ok: true }
}

export async function approveTimeBillingRowAction(input: PendingPayload) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const result = await applyTimeBillingVisitUpdate(supabase, user?.id ?? null, input, 'approved')
  if (!result.ok) return { error: result.error }
  revalidatePath(PATH)
  revalidatePath(REPORT_PAYROLL_PATH)
  return { ok: true }
}

export async function voidTimeBillingRowAction(input: PendingPayload) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const result = await applyTimeBillingVisitUpdate(supabase, user?.id ?? null, input, 'voided')
  if (!result.ok) return { error: result.error }
  revalidatePath(PATH)
  revalidatePath(REPORT_PAYROLL_PATH)
  return { ok: true }
}
