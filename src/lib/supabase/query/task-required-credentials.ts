import type { Supabase } from '../types'

export type CaregiverSkillCatalogItem = {
  type: string
  name: string
}

/**
 * Build caregiver skill catalog from task_required_credentials instead of hardcoded constants.
 * We keep only credential_catalog rows of credential_type = 'skill'.
 */
export async function getCaregiverSkillCatalogFromTaskRequirements(supabase: Supabase) {
  const { data, error } = await supabase
    .from('task_required_credentials')
    .select(
      `
      task_catalog:task_id (task_categories(name)),
      credential_catalog:credential_id (name, credential_type)
    `
    )
    .order('created_at', { ascending: true })

  if (error) return { data: null, error }

  type Row = {
    task_catalog?:
      | { task_categories?: { name?: string | null } | Array<{ name?: string | null }> | null }
      | Array<{ task_categories?: { name?: string | null } | Array<{ name?: string | null }> | null }>
      | null
    credential_catalog?: { name?: string | null; credential_type?: string | null } | Array<{ name?: string | null; credential_type?: string | null }> | null
  }

  const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)
  const out: CaregiverSkillCatalogItem[] = []
  const seen = new Set<string>()

  for (const raw of (data ?? []) as Row[]) {
    const task = first(raw.task_catalog) as { task_categories?: { name?: string | null } | Array<{ name?: string | null }> | null } | null
    const cred = first(raw.credential_catalog)
    const credentialType = (cred?.credential_type ?? '').trim().toLowerCase()
    if (credentialType !== 'skill') continue
    const name = (cred?.name ?? '').trim()
    if (!name) continue
    const cat = task ? first(task.task_categories) : null
    const type = (cat?.name ?? '').trim() || 'Other'
    const key = `${type}::${name}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ type, name })
  }

  // Same credential name can appear on multiple tasks; missing task category becomes "Other".
  // Prefer a non-"Other" category so display and grouping match the real skill family.
  const bestTypeByName = new Map<string, string>()
  for (const { type, name } of out) {
    const prev = bestTypeByName.get(name)
    if (prev === undefined) bestTypeByName.set(name, type)
    else if (prev === 'Other' && type !== 'Other') bestTypeByName.set(name, type)
  }
  const deduped: CaregiverSkillCatalogItem[] = []
  const seenNames = new Set<string>()
  for (const { name } of out) {
    if (seenNames.has(name)) continue
    seenNames.add(name)
    deduped.push({ name, type: bestTypeByName.get(name)! })
  }

  return { data: deduped, error: null }
}
