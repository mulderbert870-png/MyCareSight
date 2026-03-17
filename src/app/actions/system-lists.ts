'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

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
      .from('staff_roles')
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
      .from('staff_roles')
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
      .from('staff_roles')
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
      .from('staff_roles')
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
