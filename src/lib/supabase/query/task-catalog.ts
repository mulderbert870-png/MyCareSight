import type { Supabase } from '../types'

type TaskCatalogRow = {
  id?: string | null
  code?: string | null
  name: string | null
  category: string | null
  description?: string | null
}

/** ADL/IADL options sourced from task_catalog for patient ADL planning UI. */
export async function getTaskCatalogAdlLists(supabase: Supabase) {
  const { data, error } = await supabase
    .from('task_catalog')
    .select('name, category')
    .eq('service_type', 'non_skilled')
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return { data: null, error }

  const normalized = ((data ?? []) as TaskCatalogRow[])
    .map((r) => ({
      name: (r.name ?? '').trim(),
      group: (r.category ?? '').trim() || 'General',
    }))
    .filter((r) => r.name.length > 0)

  return { data: normalized, error: null }
}

export async function getTaskCatalogSkilledTasks(supabase: Supabase) {
  const { data, error } = await supabase
    .from('task_catalog')
    .select('id, code, name, category, description')
    .eq('service_type', 'skilled')
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return { data: null, error }

  const normalized = ((data ?? []) as TaskCatalogRow[])
    .map((r) => ({
      id: (r.id ?? '').trim(),
      code: (r.code ?? '').trim(),
      name: (r.name ?? '').trim(),
      category: (r.category ?? '').trim() || 'General',
      description: r.description ?? null,
    }))
    .filter((r) => r.id.length > 0 && r.name.length > 0)

  return { data: normalized, error: null }
}
