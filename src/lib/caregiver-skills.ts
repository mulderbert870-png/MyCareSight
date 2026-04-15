/**
 * Normalize skill names stored in caregiver_members.skills (trim, drop empties, dedupe).
 * Prevents mismatches between list UI and Edit Skills when legacy rows have extra whitespace.
 */
export function normalizeCaregiverSkillsList(skills: string[] | null | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of skills ?? []) {
    if (typeof raw !== 'string') continue
    const t = raw.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}
