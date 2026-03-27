/**
 * Proximity score for assignment matching: linear from 0–20 miles (100% at 0 mi, 0% at 20 mi).
 * Caregivers beyond 20 miles must not be shown — this returns null for distance > 20.
 */
export function proximityPercentFromMiles(distanceMiles: number): number | null {
  if (distanceMiles > 20) return null
  if (distanceMiles < 0) return 100
  const pct = 100 * (1 - distanceMiles / 20)
  return Math.max(0, Math.round(pct))
}

/** Overall score: average of skill match (0–100) and proximity (0–100). */
export function overallScorePercent(skillMatchPercent: number, proximityPercent: number): number {
  return Math.round((skillMatchPercent + proximityPercent) / 2)
}
