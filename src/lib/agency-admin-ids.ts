/**
 * Normalize agencies.agency_admin_ids for JS (Postgres uuid[] can deserialize as string `{id1,id2}`).
 */
export function normalizeAgencyAdminIds(raw: string[] | string | null | undefined): string[] {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw.map((x) => String(x))
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (t.startsWith('{') && t.endsWith('}')) {
      return t
        .slice(1, -1)
        .split(',')
        .map((p) => p.replace(/^["']|["']$/g, '').trim())
        .filter(Boolean)
    }
    try {
      const j = JSON.parse(t) as unknown
      if (Array.isArray(j)) return j.map((x) => String(x))
    } catch {
      /* ignore */
    }
    return t ? [t] : []
  }
  return []
}
