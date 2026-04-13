'use server'

import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'

const COORDINATOR_PATH = '/pages/agency/care-visits'
const CAREGIVER_PATH = '/pages/caregiver/my-care-visits'

function revalidateVisitsPages() {
  revalidatePath(COORDINATOR_PATH)
  revalidatePath(CAREGIVER_PATH)
  revalidatePath(CAREGIVER_PATH, 'layout')
}

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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isValidRequestId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && id !== 'null' && UUID_RE.test(id)
}

export async function approveScheduleAssignmentRequestAction(
  requestId: string
): Promise<{ ok?: true; error?: string }> {
  const session = await getSession()
  if (!session?.user?.id) return { error: 'You must be signed in.' }
  if (!isValidRequestId(requestId)) return { error: 'Invalid request. Refresh the page and try again.' }

  const supabase = await createClient()
  const { data, error } = await q.approveScheduleAssignmentRequestRpc(supabase, requestId)

  if (error) {
    return { error: error.message }
  }

  const body = data as RpcPayload | null
  if (!body?.ok) {
    return { error: mapRpcError(body?.error) }
  }

  revalidateVisitsPages()
  return { ok: true }
}

export async function declineScheduleAssignmentRequestAction(
  requestId: string,
  reason: string
): Promise<{ ok?: true; error?: string }> {
  const session = await getSession()
  if (!session?.user?.id) return { error: 'You must be signed in.' }
  if (!isValidRequestId(requestId)) return { error: 'Invalid request. Refresh the page and try again.' }

  const supabase = await createClient()
  const { data, error } = await q.declineScheduleAssignmentRequestRpc(supabase, requestId, reason)

  if (error) {
    return { error: error.message }
  }

  const body = data as RpcPayload | null
  if (!body?.ok) {
    return { error: mapRpcError(body?.error) }
  }

  revalidateVisitsPages()
  return { ok: true }
}

function mapSubmitAssignmentRequestError(code: string | undefined): string {
  switch (code) {
    case 'not_authenticated':
      return 'You must be signed in.'
    case 'cannot_request':
      return 'You cannot request this visit. It may be assigned, missing agency data, or not in your agency.'
    case 'duplicate_pending':
      return 'You already have a pending request for this visit.'
    default:
      return 'Could not submit request.'
  }
}

/** Logged-in caregiver requests an open visit (same agency; visit must be unassigned). Uses DB RPC to avoid INSERT RLS issues. */
export async function requestScheduleAssignmentAction(
  scheduleId: string,
  caregiverNote?: string | null
): Promise<{ ok?: true; error?: string }> {
  const session = await getSession()
  if (!session?.user?.id) return { error: 'You must be signed in.' }

  const supabase = await createClient()
  const note = caregiverNote?.trim() ? caregiverNote.trim() : ''
  const { data, error } = await q.submitScheduleAssignmentRequestRpc(supabase, scheduleId, note || null)

  if (error) {
    return { error: error.message || 'Could not submit request.' }
  }

  const body = data as { ok?: boolean; error?: string } | null
  if (!body?.ok) {
    return { error: mapSubmitAssignmentRequestError(body?.error) }
  }

  revalidateVisitsPages()
  return { ok: true }
}

function mapCancelAssignmentRequestError(code: string | undefined): string {
  switch (code) {
    case 'not_authenticated':
      return 'You must be signed in.'
    case 'not_found':
      return 'This request was not found. Refresh the page and try again.'
    case 'not_pending':
      return 'This request is no longer pending.'
    case 'forbidden':
      return 'You are not allowed to cancel this request.'
    default:
      return 'Could not cancel request.'
  }
}

/** Caregiver cancels their own pending assignment request (RPC notifies agency staff). */
export async function cancelScheduleAssignmentRequestAction(
  requestId: string
): Promise<{ ok?: true; error?: string }> {
  const session = await getSession()
  if (!session?.user?.id) return { error: 'You must be signed in.' }
  if (!isValidRequestId(requestId)) return { error: 'Invalid request. Refresh the page and try again.' }

  const supabase = await createClient()
  const { error, data } = await q.cancelScheduleAssignmentRequestRpc(supabase, requestId)
  if (error) {
    return { error: error.message || 'Could not cancel request.' }
  }

  const body = data as RpcPayload | null
  if (!body?.ok) {
    return { error: mapCancelAssignmentRequestError(body?.error) }
  }

  revalidateVisitsPages()
  return { ok: true }
}

export async function markScheduleMissedAction(
  scheduleId: string,
  reason?: string
): Promise<{ ok?: true; error?: string }> {
  const session = await getSession()
  if (!session?.user?.id) return { error: 'You must be signed in.' }
  const supabase = await createClient()
  const { data, error } = await q.updateSchedule(supabase, scheduleId, {
    status: 'missed',
    notes: reason?.trim() ? reason.trim() : null,
  })
  if (error) return { error: error.message || 'Could not mark visit as missed.' }
  if ((data?.status ?? '').toLowerCase().trim() !== 'missed') {
    return { error: 'Visit status was not updated to missed. Please refresh and try again.' }
  }
  revalidateVisitsPages()
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
  revalidateVisitsPages()
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
  revalidateVisitsPages()
  return { ok: true }
}
