import type { Supabase } from '../types'

export type ScheduleAssignmentStatus = 'pending' | 'approved' | 'declined'

export interface ScheduleAssignmentRequestRow {
  id: string
  schedule_id: string
  caregiver_member_id: string
  status: ScheduleAssignmentStatus
  caregiver_note: string | null
  decline_reason: string | null
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
  updated_at: string
}

const requestSelect = `
  id,
  schedule_id,
  caregiver_member_id,
  status,
  caregiver_note,
  decline_reason,
  resolved_at,
  resolved_by,
  created_at,
  updated_at
`

/** Pending assignment requests (RLS limits to accessible patients). */
export async function getPendingScheduleAssignmentRequests(supabase: Supabase) {
  return supabase
    .from('schedule_assignment_requests')
    .select(requestSelect)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
}

/** Recently resolved requests for coordinator history. */
export async function getRecentResolvedScheduleAssignmentRequests(supabase: Supabase, limit = 40) {
  return supabase
    .from('schedule_assignment_requests')
    .select(requestSelect)
    .in('status', ['approved', 'declined'])
    .not('resolved_at', 'is', null)
    .order('resolved_at', { ascending: false })
    .limit(limit)
}

export async function approveScheduleAssignmentRequestRpc(supabase: Supabase, requestId: string) {
  return supabase.rpc('approve_schedule_assignment_request', { p_request_id: requestId })
}

export async function declineScheduleAssignmentRequestRpc(
  supabase: Supabase,
  requestId: string,
  reason: string | null
) {
  return supabase.rpc('decline_schedule_assignment_request', {
    p_request_id: requestId,
    p_reason: reason ?? '',
  })
}

/** Caregiver submits a request via RPC (bypasses brittle INSERT RLS; server validates agency + open visit). */
export async function submitScheduleAssignmentRequestRpc(
  supabase: Supabase,
  scheduleId: string,
  caregiverNote: string | null
) {
  return supabase.rpc('submit_schedule_assignment_request', {
    p_schedule_id: scheduleId,
    p_caregiver_note: caregiverNote ?? '',
  })
}

/** Caregiver withdraws their pending request via RPC (notifies coordinators; same validation as DELETE RLS). */
export async function cancelScheduleAssignmentRequestRpc(supabase: Supabase, requestId: string) {
  return supabase.rpc('cancel_schedule_assignment_request', { p_request_id: requestId })
}

/** Direct insert (coordinator tooling / tests). Prefer {@link submitScheduleAssignmentRequestRpc} for caregivers. */
export async function insertScheduleAssignmentRequest(
  supabase: Supabase,
  data: { schedule_id: string; caregiver_member_id: string; caregiver_note?: string | null }
) {
  return supabase
    .from('schedule_assignment_requests')
    .insert({
      schedule_id: data.schedule_id,
      caregiver_member_id: data.caregiver_member_id,
      status: 'pending',
      caregiver_note: data.caregiver_note ?? null,
    })
    .select('id')
    .single()
}
