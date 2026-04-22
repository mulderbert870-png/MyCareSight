'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import * as q from '@/lib/supabase/query'

export interface CreateExpertData {
  firstName: string
  lastName: string
  email: string
  phone?: string
  password: string
  expertise?: string
  role?: string
  status?: 'active' | 'inactive'
}

export async function createExpert(data: CreateExpertData) {
  const supabase = await createClient()

  try {
    // RPC creates auth user and licensing_experts row.
    const { data: expertId, error } = await q.rpcCreateLicensingExpert(supabase, {
      p_first_name: data.firstName,
      p_last_name: data.lastName,
      p_email: data.email,
      p_password: data.password,
      p_phone: data.phone || null,
      p_expertise: data.expertise || null,
      p_role: data.role || 'Licensing Specialist',
      p_status: data.status || 'active',
    })

    if (error) {
      return { error: error.message, data: null }
    }

    if (!expertId) {
      return { error: 'Failed to create expert', data: null }
    }

    // Fetch the created expert to return
    const { data: expert, error: fetchError } = await q.getLicensingExpertById(supabase, expertId)

    if (fetchError) {
      // Expert was created but we can't fetch it - still return success
      return { error: null, data: { id: expertId } as any }
    }

    revalidatePath('/pages/admin/experts')
    return { error: null, data: expert }
  } catch (err: any) {
    return { error: err.message || 'Failed to create expert', data: null }
  }
}
