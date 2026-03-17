'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export interface CreateCertificationData {
  type: string
  license_number: string
  state?: string | null
  issue_date?: string | null
  expiration_date: string
  issuing_authority: string
  status: string
  document_url?: string | null
}

export async function createCertification(data: CreateCertificationData) {
  const supabase = await createClient()

  try {
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return { error: 'You must be logged in to create a certification', data: null }
    }

    // Insert certification
    const { data: certification, error: insertError } = await supabase
      .from('certifications')
      .insert({
        user_id: user.id,
        type: data.type,
        license_number: data.license_number,
        state: data.state || null,
        issue_date: data.issue_date || null,
        expiration_date: data.expiration_date,
        issuing_authority: data.issuing_authority,
        status: data.status,
        document_url: data.document_url || null,
      })
      .select()
      .single()

    if (insertError) {
      return { error: insertError.message, data: null }
    }

    revalidatePath('/pages/caregiver/my-certifications')
    return { error: null, data: certification }
  } catch (err: any) {
    return { error: err.message || 'Failed to create certification', data: null }
  }
}

export async function getCertifications() {
  const supabase = await createClient()

  try {
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return { error: 'You must be logged in', data: null }
    }

    // Get certifications
    const { data: certifications, error: fetchError } = await supabase
      .from('certifications')
      .select('*')
      .eq('user_id', user.id)
      .order('expiration_date', { ascending: true })

    if (fetchError) {
      return { error: fetchError.message, data: null }
    }

    return { error: null, data: certifications }
  } catch (err: any) {
    return { error: err.message || 'Failed to fetch certifications', data: null }
  }
}

export async function getCertificationTypes() {
  const supabase = await createClient()

  try {
    const { data: types, error } = await supabase
      .from('certification_types')
      .select('*')
      .order('certification_type', { ascending: true })

    if (error) {
      return { error: error.message, data: null }
    }

    return { error: null, data: types }
  } catch (err: any) {
    return { error: err.message || 'Failed to fetch certification types', data: null }
  }
}

export interface UpdateCertificationData {
  type: string
  license_number: string
  state?: string | null
  issue_date?: string | null
  expiration_date: string
  issuing_authority: string
  status: string
  document_url?: string | null
}

export async function updateCertification(certificationId: string, data: UpdateCertificationData) {
  const supabase = await createClient()

  try {
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return { error: 'You must be logged in to update a certification', data: null }
    }

    // Update certification
    const { data: certification, error: updateError } = await supabase
      .from('certifications')
      .update({
        type: data.type,
        license_number: data.license_number,
        state: data.state || null,
        issue_date: data.issue_date || null,
        expiration_date: data.expiration_date,
        issuing_authority: data.issuing_authority,
        status: data.status,
        document_url: data.document_url || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', certificationId)
      .eq('user_id', user.id) // Ensure user owns this certification
      .select()
      .single()

    if (updateError) {
      return { error: updateError.message, data: null }
    }

    revalidatePath('/pages/caregiver/my-certifications')
    revalidatePath(`/pages/caregiver/my-certifications/${certificationId}`)
    return { error: null, data: certification }
  } catch (err: any) {
    return { error: err.message || 'Failed to update certification', data: null }
  }
}

export async function getCertification(certificationId: string) {
  const supabase = await createClient()

  try {
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return { error: 'You must be logged in', data: null }
    }

    // Get certification
    const { data: certification, error: fetchError } = await supabase
      .from('certifications')
      .select('*')
      .eq('id', certificationId)
      .eq('user_id', user.id) // Ensure user owns this certification
      .single()

    if (fetchError) {
      return { error: fetchError.message, data: null }
    }

    return { error: null, data: certification }
  } catch (err: any) {
    return { error: err.message || 'Failed to fetch certification', data: null }
  }
}
