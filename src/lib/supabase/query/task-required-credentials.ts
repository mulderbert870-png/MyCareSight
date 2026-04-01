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
      task_catalog:task_id (category),
      credential_catalog:credential_id (name, credential_type)
    `
    )
    .order('created_at', { ascending: true })

  if (error) return { data: null, error }

  type Row = {
    task_catalog?: { category?: string | null } | Array<{ category?: string | null }> | null
    credential_catalog?: { name?: string | null; credential_type?: string | null } | Array<{ name?: string | null; credential_type?: string | null }> | null
  }

  const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)
  const out: CaregiverSkillCatalogItem[] = []
  const seen = new Set<string>()

  for (const raw of (data ?? []) as Row[]) {
    const task = first(raw.task_catalog)
    const cred = first(raw.credential_catalog)
    const credentialType = (cred?.credential_type ?? '').trim().toLowerCase()
    if (credentialType !== 'skill') continue
    const name = (cred?.name ?? '').trim()
    if (!name) continue
    const type = (task?.category ?? '').trim() || 'Other'
    const key = `${type}::${name}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ type, name })
  }

  return { data: out, error: null }
}
