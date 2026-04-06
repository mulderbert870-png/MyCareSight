import type { Supabase } from '../types'

type TaskCategoryEmbed = { name?: string | null; service_type?: string | null } | null

type TaskCatalogAdlRow = {
  name: string | null
  task_categories?: TaskCategoryEmbed | TaskCategoryEmbed[]
}

type TaskCatalogSkilledRow = {
  id?: string | null
  code?: string | null
  name: string | null
    description?: string | null
  task_categories?: TaskCategoryEmbed | TaskCategoryEmbed[]
}

function firstCategory(v: TaskCategoryEmbed | TaskCategoryEmbed[] | null | undefined): TaskCategoryEmbed {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

/** ADL/IADL options sourced from task_catalog for patient ADL planning UI. */
export async function getTaskCatalogAdlLists(supabase: Supabase) {
  const { data, error } = await supabase
    .from('task_catalog')
    .select('name, task_categories!inner(name, service_type)')
    .eq('is_active', true)
    .eq('task_categories.service_type', 'non_skilled')
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return { data: null, error }

  const normalized = ((data ?? []) as TaskCatalogAdlRow[])
    .map((r) => {
      const cat = firstCategory(r.task_categories)
      return {
        name: (r.name ?? '').trim(),
        group: (cat?.name ?? '').trim() || 'General',
      }
    })
    .filter((r) => r.name.length > 0)

  return { data: normalized, error: null }
}

export async function getTaskCatalogSkilledTasks(supabase: Supabase) {
  const { data, error } = await supabase
    .from('task_catalog')
    .select('id, code, name, description, task_categories!inner(name, service_type)')
    .eq('is_active', true)
    .eq('task_categories.service_type', 'skilled')
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return { data: null, error }

  const normalized = ((data ?? []) as TaskCatalogSkilledRow[])
    .map((r) => {
      const cat = firstCategory(r.task_categories)
      return {
        id: (r.id ?? '').trim(),
        code: (r.code ?? '').trim(),
        name: (r.name ?? '').trim(),
        category: (cat?.name ?? '').trim() || 'General',
        description: r.description ?? null,
      }
    })
    .filter((r) => r.id.length > 0 && r.name.length > 0)

  return { data: normalized, error: null }
}
