/**
 * Resolve caregiver pay for a visit date from `caregiver_pay_rates` (and optional legacy `pay_rate_schedule`).
 */

export type CaregiverPayRateRow = {
  caregiver_member_id: string
  pay_rate: number
  unit_type: string | null
  service_type: string | null
  effective_start: string
  effective_end: string | null
}

export type LegacyPayRateScheduleRow = {
  caregiver_member_id: string
  rate: number
  unit_type: string | null
  service_type: string | null
  effective_start: string
  effective_end: string | null
  status: string | null
}

export function pickCaregiverPayRateForVisit(
  caregiverId: string,
  serviceType: string,
  visitDate: string,
  rows: CaregiverPayRateRow[]
): CaregiverPayRateRow | null {
  const candidates = rows.filter(
    (r) =>
      r.caregiver_member_id === caregiverId &&
      (r.service_type == null || r.service_type === serviceType) &&
      r.effective_start <= visitDate &&
      (!r.effective_end || r.effective_end >= visitDate)
  )
  const hit = candidates
    .sort((a, b) => {
      const byStart = b.effective_start.localeCompare(a.effective_start)
      if (byStart !== 0) return byStart
      const aSpec = a.service_type != null ? 1 : 0
      const bSpec = b.service_type != null ? 1 : 0
      return bSpec - aSpec
    })[0]
  return hit ?? null
}

export function pickLegacyPayRateScheduleForVisit(
  caregiverId: string,
  serviceType: string,
  visitDate: string,
  rows: LegacyPayRateScheduleRow[]
): LegacyPayRateScheduleRow | null {
  const candidates = rows.filter(
    (r) =>
      r.caregiver_member_id === caregiverId &&
      (r.service_type == null || r.service_type === serviceType) &&
      r.status === 'active' &&
      r.effective_start <= visitDate &&
      (!r.effective_end || r.effective_end >= visitDate)
  )
  return (
    candidates
      .sort((a, b) => {
        const byStart = b.effective_start.localeCompare(a.effective_start)
        if (byStart !== 0) return byStart
        const aSpec = a.service_type != null ? 1 : 0
        const bSpec = b.service_type != null ? 1 : 0
        return bSpec - aSpec
      })[0] ?? null
  )
}

/** Prefer `caregiver_pay_rates`; fall back to legacy `pay_rate_schedule` when no match. */
export function resolvePayRateForVisit(
  caregiverId: string,
  serviceType: string,
  visitDate: string,
  caregiverPayRows: CaregiverPayRateRow[],
  legacyScheduleRows: LegacyPayRateScheduleRow[]
): { rate: number; unit_type: string | null } | null {
  const modern = pickCaregiverPayRateForVisit(caregiverId, serviceType, visitDate, caregiverPayRows)
  if (modern) return { rate: Number(modern.pay_rate ?? 0), unit_type: modern.unit_type }
  const leg = pickLegacyPayRateScheduleForVisit(caregiverId, serviceType, visitDate, legacyScheduleRows)
  if (leg) return { rate: Number(leg.rate ?? 0), unit_type: leg.unit_type }
  return null
}
