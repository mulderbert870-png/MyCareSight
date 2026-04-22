'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { Supabase } from '@/lib/supabase/types'

const PATH = '/pages/agency/time-billing'

type PendingPayload = {
  scheduledVisitId: string
  hours: number
  note: string
  serviceType: 'non_skilled' | 'skilled'
}

async function applyTimeBillingVisitUpdate(
  supabase: Supabase,
  input: PendingPayload,
  billingState: 'approved' | 'voided'
): Promise<{ ok: true } | { ok: false; error: string }> {
  const hours = Number(input.hours)
  if (!Number.isFinite(hours) || hours < 0) {
    return { ok: false, error: 'Hours must be a valid number.' }
  }

  const { data: sv, error: svErr } = await supabase
    .from('scheduled_visits')
    .select('id, caregiver_member_id, patient_id, visit_date')
    .eq('id', input.scheduledVisitId)
    .single()

  if (svErr || !sv) {
    return { ok: false, error: svErr?.message || 'Visit not found.' }
  }

  const visit = sv as { id: string; caregiver_member_id: string | null; patient_id: string; visit_date: string }

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
    .select('bill_rate, bill_unit_type, effective_date, end_date, status')
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
  const result = await applyTimeBillingVisitUpdate(supabase, input, 'approved')
  if (!result.ok) return { error: result.error }
  revalidatePath(PATH)
  return { ok: true }
}

export async function voidTimeBillingRowAction(input: PendingPayload) {
  const supabase = await createClient()
  const result = await applyTimeBillingVisitUpdate(supabase, input, 'voided')
  if (!result.ok) return { error: result.error }
  revalidatePath(PATH)
  return { ok: true }
}
