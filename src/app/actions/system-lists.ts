'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

type ServiceType = 'skilled' | 'non_skilled'
type TaskCategoryItem = { id: string; name: string }
type TaskCatalogItem = { id: string; name: string; categoryId: string; categoryName: string }

// Certification Types Actions
export async function getCertificationTypes() {
  const supabase = await createClient()

  console.log('getCertificationTypes')
  try {
    const { data: types, error } = await supabase
      .from('certification_types')
      .select('*')
      .order('certification_type', { ascending: true })

      console.log("types: ",types)
    if (error) {
      return { error: error.message, data: null }
    }

    return { error: null, data: types }
  } catch (err: any) {
    return { error: err.message || 'Failed to fetch certification types', data: null }
  }
}

export async function createCertificationType(certificationType: string) {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from('certification_types')
      .insert({ certification_type: certificationType })
      .select()
      .single()

    if (error) {
      return { error: error.message, data: null }
    }

    revalidatePath('/pages/admin/configuration')
    return { error: null, data }
  } catch (err: any) {
    return { error: err.message || 'Failed to create certification type', data: null }
  }
}

export async function updateCertificationType(id: number, certificationType: string) {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from('certification_types')
      .update({ certification_type: certificationType })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return { error: error.message, data: null }
    }

    revalidatePath('/pages/admin/configuration')
    return { error: null, data }
  } catch (err: any) {
    return { error: err.message || 'Failed to update certification type', data: null }
  }
}

export async function deleteCertificationType(id: number) {
  const supabase = await createClient()

  try {
    const { error } = await supabase
      .from('certification_types')
      .delete()
      .eq('id', id)

    if (error) {
      return { error: error.message }
    }

    revalidatePath('/pages/admin/configuration')
    return { error: null }
  } catch (err: any) {
    return { error: err.message || 'Failed to delete certification type' }
  }
}


// Staff Roles Actions (UI only for now - table exists but actions not implemented)
export async function getStaffRoles() {
  const supabase = await createClient()

  try {
    const { data: roles, error } = await supabase
      .from('caregiver_roles')
      .select('*')
      .order('name', { ascending: true })

    if (error) {
      // Table might not exist yet, return empty array
      if (error.code === '42P01') {
        return { error: null, data: [] }
      }
      return { error: error.message, data: null }
    }

    return { error: null, data: roles || [] }
  } catch (err: any) {
    return { error: null, data: [] } // Return empty array if table doesn't exist
  }
}

export async function createStaffRole(name: string) {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from('caregiver_roles')
      .insert({ name })
      .select()
      .single()

    if (error) {
      return { error: error.message, data: null }
    }

    revalidatePath('/pages/admin/configuration')
    return { error: null, data }
  } catch (err: any) {
    return { error: err.message || 'Failed to create staff role', data: null }
  }
}

export async function updateStaffRole(id: number, name: string) {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from('caregiver_roles')
      .update({ name })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return { error: error.message, data: null }
    }
    
    revalidatePath('/pages/admin/configuration')
    return { error: null, data }
  } catch (err: any) {
    return { error: err.message || 'Failed to update staff role', data: null }
  }
}

export async function deleteStaffRole(id: number) {
  const supabase = await createClient() 

  try {
    const { error } = await supabase
      .from('caregiver_roles')
      .delete()
      .eq('id', id)

    if (error) {
      return { error: error.message }
    }

    revalidatePath('/pages/admin/configuration')
    return { error: null }
  } catch (err: any) {
    return { error: err.message || 'Failed to delete staff role' }
  }
}

async function ensureDefaultTaskCategory(supabase: Awaited<ReturnType<typeof createClient>>, serviceType: ServiceType) {
  const { data: existing, error: readErr } = await supabase
    .from('task_categories')
    .select('id')
    .eq('service_type', serviceType)
    .eq('name', 'General')
    .limit(1)
    .maybeSingle()

  if (readErr) return { error: readErr.message, id: null as string | null }
  if (existing?.id) return { error: null, id: existing.id as string }

  const { data: inserted, error: insertErr } = await supabase
    .from('task_categories')
    .insert({ name: 'General', service_type: serviceType, display_order: 0 })
    .select('id')
    .single()

  if (insertErr) return { error: insertErr.message, id: null as string | null }
  return { error: null, id: inserted.id as string }
}

function taskCodeFromName(name: string, serviceType: ServiceType): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36)
  const suffix = Date.now().toString(36)
  return `${serviceType}_${normalized || 'task'}_${suffix}`
}

async function getTasksByServiceType(serviceType: ServiceType) {
  const supabase = await createClient()
  try {
    const { data, error } = await supabase
      .from('task_catalog')
      .select('id, name, category_id, task_categories!inner(id, name, service_type)')
      .eq('task_categories.service_type', serviceType)
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) return { error: error.message, data: null }
    const normalized = (data ?? [])
      .map((row: any) => {
        const category = Array.isArray(row.task_categories) ? row.task_categories[0] : row.task_categories
        return {
          id: String(row.id),
          name: String(row.name ?? '').trim(),
          categoryId: String(row.category_id ?? category?.id ?? ''),
          categoryName: String(category?.name ?? '').trim() || 'General',
        } satisfies TaskCatalogItem
      })
      .filter((row) => row.id && row.name)

    return {
      error: null,
      data: normalized,
    }
  } catch (err: any) {
    return { error: err.message || 'Failed to fetch tasks', data: null }
  }
}

async function getTaskCategoriesByServiceType(serviceType: ServiceType) {
  const supabase = await createClient()
  try {
    const { data, error } = await supabase
      .from('task_categories')
      .select('id, name')
      .eq('service_type', serviceType)
      .order('display_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) return { error: error.message, data: null }
    const normalized = (data ?? [])
      .map((row: any) => ({ id: String(row.id), name: String(row.name ?? '').trim() } satisfies TaskCategoryItem))
      .filter((row) => row.id && row.name)

    return { error: null, data: normalized }
  } catch (err: any) {
    return { error: err.message || 'Failed to fetch task categories', data: null }
  }
}

export async function getSkilledTasks() {
  return getTasksByServiceType('skilled')
}

export async function getNonSkilledTasks() {
  return getTasksByServiceType('non_skilled')
}

export async function getSkilledTaskCategories() {
  return getTaskCategoriesByServiceType('skilled')
}

export async function getNonSkilledTaskCategories() {
  return getTaskCategoriesByServiceType('non_skilled')
}

async function getTaskCatalogItemById(id: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('task_catalog')
    .select('id, name, category_id, task_categories!inner(name)')
    .eq('id', id)
    .single()

  if (error) return { error: error.message, data: null }

  const category = Array.isArray((data as any).task_categories)
    ? (data as any).task_categories[0]
    : (data as any).task_categories
  return {
    error: null,
    data: {
      id: String((data as any).id),
      name: String((data as any).name ?? '').trim(),
      categoryId: String((data as any).category_id ?? ''),
      categoryName: String(category?.name ?? '').trim() || 'General',
    } satisfies TaskCatalogItem,
  }
}

export async function createTaskCatalogItem(serviceType: ServiceType, name: string, categoryId?: string | null) {
  const supabase = await createClient()
  try {
    const trimmedName = name.trim()
    if (!trimmedName) return { error: 'Task name is required.', data: null }

    let resolvedCategoryId = (categoryId ?? '').trim()
    if (!resolvedCategoryId) {
      const category = await ensureDefaultTaskCategory(supabase, serviceType)
      if (category.error || !category.id) return { error: category.error || 'Could not resolve task category.', data: null }
      resolvedCategoryId = category.id
    }

    const { data, error } = await supabase
      .from('task_catalog')
      .insert({
        code: taskCodeFromName(trimmedName, serviceType),
        name: trimmedName,
        category_id: resolvedCategoryId,
        is_skilled: serviceType === 'skilled',
      })
      .select('id')
      .single()

    if (error) return { error: error.message, data: null }
    const item = await getTaskCatalogItemById(String((data as any).id))
    if (item.error || !item.data) return { error: item.error || 'Task created but could not be loaded.', data: null }
    revalidatePath('/pages/admin/configuration')
    return { error: null, data: item.data }
  } catch (err: any) {
    return { error: err.message || 'Failed to create task', data: null }
  }
}

export async function updateTaskCatalogItem(id: string, name: string) {
  const supabase = await createClient()
  try {
    const trimmedName = name.trim()
    if (!trimmedName) return { error: 'Task name is required.', data: null }

    const { data, error } = await supabase
      .from('task_catalog')
      .update({ name: trimmedName })
      .eq('id', id)
      .select('id')
      .single()

    if (error) return { error: error.message, data: null }
    const item = await getTaskCatalogItemById(String((data as any).id))
    if (item.error || !item.data) return { error: item.error || 'Task updated but could not be loaded.', data: null }
    revalidatePath('/pages/admin/configuration')
    return { error: null, data: item.data }
  } catch (err: any) {
    return { error: err.message || 'Failed to update task', data: null }
  }
}

export async function deleteTaskCatalogItem(id: string) {
  const supabase = await createClient()
  try {
    const { error } = await supabase.from('task_catalog').delete().eq('id', id)
    if (error) return { error: error.message }
    revalidatePath('/pages/admin/configuration')
    return { error: null }
  } catch (err: any) {
    return { error: err.message || 'Failed to delete task' }
  }
}
