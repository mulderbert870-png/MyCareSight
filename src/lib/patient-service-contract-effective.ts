import type { PatientServiceContractRow } from '@/lib/supabase/query/patient-service-contracts'

/** Rows created only for weekly hour caps (separate timeline from billing visit contracts). */
export const WEEKLY_HOURS_CONTRACT_TYPE = 'weekly_hours'

export function patientServiceContractBillingRows(rows: PatientServiceContractRow[]): PatientServiceContractRow[] {
  return rows.filter((r) => r.contract_type !== WEEKLY_HOURS_CONTRACT_TYPE)
}

/**
 * Contract applies on calendar day `ymd` (same rule as `getActiveContractedHoursForDate`):
 * effective_date <= ymd and (open-ended or end_date >= ymd).
 * Explicit `status === 'inactive'` excludes the row (manual void).
 */
export function patientServiceContractOverlapsDate(
  row: Pick<PatientServiceContractRow, 'effective_date' | 'end_date' | 'status'>,
  ymd: string
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false
  if (String(row.status ?? '').toLowerCase() === 'inactive') return false
  if (row.effective_date > ymd) return false
  if (row.end_date != null && row.end_date < ymd) return false
  return true
}

export function sortPatientServiceContractsByRecency(a: PatientServiceContractRow, b: PatientServiceContractRow): number {
  const byEff = b.effective_date.localeCompare(a.effective_date)
  if (byEff !== 0) return byEff
  const byCr = (b.created_at ?? '').localeCompare(a.created_at ?? '')
  if (byCr !== 0) return byCr
  const byUp = (b.updated_at ?? '').localeCompare(a.updated_at ?? '')
  if (byUp !== 0) return byUp
  return b.id.localeCompare(a.id)
}

/** Latest contract in force for this patient's timeline group on `asOf` (matches RPC grouping). */
export function patientServiceContractPickCurrentForTimeline(
  sameTimelineRows: PatientServiceContractRow[],
  asOf: string
): PatientServiceContractRow | null {
  const applicable = sameTimelineRows.filter((r) => patientServiceContractOverlapsDate(r, asOf))
  if (applicable.length === 0) return null
  return [...applicable].sort(sortPatientServiceContractsByRecency)[0]
}

export type PatientServiceContractUiPhase = 'current' | 'future' | 'ended'

/** Badge for a row vs full list: which phase the row is in for calendar day `asOf`. */
export function patientServiceContractUiPhase(
  row: PatientServiceContractRow,
  allRows: PatientServiceContractRow[],
  asOf: string
): PatientServiceContractUiPhase {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return 'ended'
  if (row.effective_date > asOf) return 'future'
  const peers = allRows.filter((r) => r.contract_type === row.contract_type && r.service_type === row.service_type)
  const winner = patientServiceContractPickCurrentForTimeline(peers, asOf)
  if (winner && winner.id === row.id) return 'current'
  return 'ended'
}

/** Billing contracts the user may attach to a visit on `asOf` (visit / repeat start date). */
export function patientServiceContractsSelectableForBillingVisit(
  rows: PatientServiceContractRow[],
  asOf: string
): PatientServiceContractRow[] {
  const billing = patientServiceContractBillingRows(rows)
  const list = billing.filter((r) => patientServiceContractOverlapsDate(r, asOf))
  return [...list].sort((a, b) => {
    const st = a.service_type.localeCompare(b.service_type)
    if (st !== 0) return st
    return sortPatientServiceContractsByRecency(a, b)
  })
}
