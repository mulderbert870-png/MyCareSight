'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import type { Supabase } from '@/lib/supabase/types'

const PATH = '/pages/agency/time-billing'

type PendingPayload = {
  scheduledVisitId: string
  timeEntryId: string | null
  hours: number
  note: string
  serviceType: 'non_skilled' | 'skilled'
}

async function ensureAndUpdateTimeBillingPendingRow(
  supabase: Supabase,
  input: PendingPayload
): Promise<{ ok: true; entryId: string } | { ok: false; error: string }> {
  const hours = Number(input.hours)
  if (!Number.isFinite(hours) || hours < 0) {
    return { ok: false, error: 'Hours must be a valid number.' }
  }

  const { data: sv, error: svErr } = await supabase
    .from('scheduled_visits')
    .select('id, agency_id, patient_id, caregiver_member_id')
    .eq('id', input.scheduledVisitId)
    .single()

  if (svErr || !sv) {
    return { ok: false, error: svErr?.message || 'Visit not found.' }
  }

  const visit = sv as {
    id: string
    agency_id: string
    patient_id: string
    caregiver_member_id: string | null
  }

  if (!visit.caregiver_member_id) {
    return {
      ok: false,
      error: 'This visit has no assigned caregiver. Assign a caregiver before approving hours.',
    }
  }

  const { error: visitErr } = await q.updateSchedule(supabase, input.scheduledVisitId, {
    service_type: input.serviceType,
  })
  if (visitErr) {
    return { ok: false, error: visitErr.message || 'Could not update service type.' }
  }

  const note = input.note?.trim() ? input.note.trim() : null

  let entryId = input.timeEntryId

  if (entryId) {
    const { error: entryErr } = await supabase
      .from('visit_time_entries')
      .update({
        actual_hours: hours,
        billable_hours: hours,
        adjustment_comment: note,
      })
      .eq('id', entryId)
      .eq('scheduled_visit_id', input.scheduledVisitId)
      .in('entry_status', ['pending_review', 'submitted'])

    if (entryErr) {
      return { ok: false, error: entryErr.message || 'Could not update time entry.' }
    }
    return { ok: true, entryId }
  }

  const { data: existing } = await supabase
    .from('visit_time_entries')
    .select('id')
    .eq('scheduled_visit_id', input.scheduledVisitId)
    .maybeSingle()

  if (existing?.id) {
    const resolvedId = existing.id
    const { error: entryErr } = await supabase
      .from('visit_time_entries')
      .update({
        actual_hours: hours,
        billable_hours: hours,
        adjustment_comment: note,
      })
      .eq('id', resolvedId)
      .in('entry_status', ['pending_review', 'submitted'])

    if (entryErr) {
      return { ok: false, error: entryErr.message || 'Could not update time entry.' }
    }
    return { ok: true, entryId: resolvedId }
  }

  const { data: inserted, error: insErr } = await supabase
    .from('visit_time_entries')
    .insert({
      agency_id: visit.agency_id,
      scheduled_visit_id: visit.id,
      patient_id: visit.patient_id,
      caregiver_member_id: visit.caregiver_member_id,
      actual_hours: hours,
      billable_hours: hours,
      adjustment_comment: note,
      entry_status: 'pending_review',
    })
    .select('id')
    .single()

  if (insErr || !inserted?.id) {
    return { ok: false, error: insErr?.message || 'Could not create time entry for this visit.' }
  }

  return { ok: true, entryId: inserted.id as string }
}

export async function approveTimeBillingRowAction(input: PendingPayload) {
  const supabase = await createClient()
  const ensured = await ensureAndUpdateTimeBillingPendingRow(supabase, input)
  if (!ensured.ok) return { error: ensured.error }

  const { error: entryErr } = await supabase
    .from('visit_time_entries')
    .update({ entry_status: 'approved' })
    .eq('id', ensured.entryId)
    .in('entry_status', ['pending_review', 'submitted'])

  if (entryErr) return { error: entryErr.message || 'Could not approve row.' }

  revalidatePath(PATH)
  return { ok: true }
}

export async function voidTimeBillingRowAction(input: PendingPayload) {
  const supabase = await createClient()
  const ensured = await ensureAndUpdateTimeBillingPendingRow(supabase, input)
  if (!ensured.ok) return { error: ensured.error }

  const { error } = await supabase
    .from('visit_time_entries')
    .update({ entry_status: 'rejected' })
    .eq('id', ensured.entryId)
    .in('entry_status', ['pending_review', 'submitted'])

  if (error) return { error: error.message || 'Could not void row.' }

  revalidatePath(PATH)
  return { ok: true }
}
