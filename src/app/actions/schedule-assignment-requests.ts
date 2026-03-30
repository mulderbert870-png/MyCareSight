'use server'

import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'

const COORDINATOR_PATH = '/pages/agency/care-visits'

function mapRpcError(code: string | undefined): string {
  switch (code) {
    case 'not_found':
      return 'This request was not found. Refresh the page and try again.'
    case 'not_pending':
      return 'This request is no longer pending.'
    case 'forbidden':
      return 'You are not allowed to perform this action.'
    case 'schedule_already_assigned':
      return 'This visit already has an assigned caregiver.'
    default:
      return 'Something went wrong. Please try again.'
  }
}

type RpcPayload = { ok?: boolean; error?: string }

export async function approveScheduleAssignmentRequestAction(
  requestId: string
): Promise<{ ok?: true; error?: string }> {
  const session = await getSession()
  if (!session?.user?.id) return { error: 'You must be signed in.' }

  const supabase = await createClient()
  const { data, error } = await q.approveScheduleAssignmentRequestRpc(supabase, requestId)

  if (error) {
    return { error: error.message }
  }

  const body = data as RpcPayload | null
  if (!body?.ok) {
    return { error: mapRpcError(body?.error) }
  }

  revalidatePath(COORDINATOR_PATH)
  return { ok: true }
}

export async function declineScheduleAssignmentRequestAction(
  requestId: string,
  reason: string
): Promise<{ ok?: true; error?: string }> {
  const session = await getSession()
  if (!session?.user?.id) return { error: 'You must be signed in.' }

  const supabase = await createClient()
  const { data, error } = await q.declineScheduleAssignmentRequestRpc(supabase, requestId, reason)

  if (error) {
    return { error: error.message }
  }

  const body = data as RpcPayload | null
  if (!body?.ok) {
    return { error: mapRpcError(body?.error) }
  }

  revalidatePath(COORDINATOR_PATH)
  return { ok: true }
}

/** Logged-in caregiver requests an open visit (same agency, schedule.caregiver_id must be null). */
export async function requestScheduleAssignmentAction(
  scheduleId: string,
  caregiverNote?: string | null
): Promise<{ ok?: true; error?: string }> {
  const session = await getSession()
  if (!session?.user?.id) return { error: 'You must be signed in.' }

  const supabase = await createClient()
  const { data: staffRow, error: staffErr } = await q.getStaffMemberByUserId(supabase, session.user.id)
  if (staffErr || !staffRow?.id) {
    return { error: 'Only caregivers can request a visit assignment.' }
  }

  const note = caregiverNote?.trim() ? caregiverNote.trim() : null
  const { error } = await q.insertScheduleAssignmentRequest(supabase, {
    schedule_id: scheduleId,
    caregiver_member_id: staffRow.id,
    caregiver_note: note,
  })

  if (error) {
    if (error.code === '23505') {
      return { error: 'You already have a pending request for this visit.' }
    }
    return { error: error.message || 'Could not submit request.' }
  }

  revalidatePath(COORDINATOR_PATH)
  return { ok: true }
}

export async function markScheduleMissedAction(
  scheduleId: string,
  reason?: string
): Promise<{ ok?: true; error?: string }> {
  const session = await getSession()
  if (!session?.user?.id) return { error: 'You must be signed in.' }
  const supabase = await createClient()
  const { error } = await q.updateSchedule(supabase, scheduleId, {
    status: 'missed',
    notes: reason?.trim() ? reason.trim() : null,
  })
  if (error) return { error: error.message || 'Could not mark visit as missed.' }
  revalidatePath(COORDINATOR_PATH)
  return { ok: true }
}

export async function assignCaregiverToScheduleAction(
  scheduleId: string,
  caregiverId: string
): Promise<{ ok?: true; error?: string }> {
  const session = await getSession()
  if (!session?.user?.id) return { error: 'You must be signed in.' }
  const supabase = await createClient()
  const { error } = await q.updateSchedule(supabase, scheduleId, {
    caregiver_id: caregiverId,
    status: 'scheduled',
  })
  if (error) return { error: error.message || 'Could not assign caregiver.' }
  revalidatePath(COORDINATOR_PATH)
  return { ok: true }
}

export async function unassignCaregiverFromScheduleAction(
  scheduleId: string
): Promise<{ ok?: true; error?: string }> {
  const session = await getSession()
  if (!session?.user?.id) return { error: 'You must be signed in.' }
  const supabase = await createClient()
  const { error } = await q.updateSchedule(supabase, scheduleId, {
    caregiver_id: null,
    status: 'scheduled',
  })
  if (error) return { error: error.message || 'Could not unassign caregiver.' }
  revalidatePath(COORDINATOR_PATH)
  return { ok: true }
}
