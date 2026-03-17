'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import * as q from '@/lib/supabase/query'

export type AgencyFormData = {
  companyName: string
  agencyAdminIds: string[]
  businessType: string
  taxId: string
  primaryLicenseNumber: string
  website?: string
  physicalStreetAddress: string
  physicalCity: string
  physicalState: string
  physicalZipCode: string
  sameAsPhysical: boolean
  mailingStreetAddress?: string
  mailingCity?: string
  mailingState?: string
  mailingZipCode?: string
}

function buildAgencyPayload(data: Omit<AgencyFormData, 'agencyAdminIds'>) {
  return {
    name: data.companyName.trim(),
    business_type: data.businessType.trim() || null,
    tax_id: data.taxId.trim() || null,
    primary_license_number: data.primaryLicenseNumber.trim() || null,
    website: data.website?.trim() || null,
    physical_street_address: data.physicalStreetAddress.trim() || null,
    physical_city: data.physicalCity.trim() || null,
    physical_state: data.physicalState.trim() || null,
    physical_zip_code: data.physicalZipCode.trim() || null,
    same_as_physical: data.sameAsPhysical ?? true,
    mailing_street_address: data.mailingStreetAddress?.trim() || null,
    mailing_city: data.mailingCity?.trim() || null,
    mailing_state: data.mailingState?.trim() || null,
    mailing_zip_code: data.mailingZipCode?.trim() || null,
    updated_at: new Date().toISOString(),
  }
}

export async function createAgency(data: AgencyFormData) {
  const supabase = await createClient()
  try {
    const ids = (data.agencyAdminIds || []).filter(Boolean)
    const { data: newAgency, error } = await q.insertAgency(supabase, {
      ...buildAgencyPayload(data),
      agency_admin_ids: ids,
    })

    if (error) {
      return { error: error.message, data: null }
    }

    const agencyId = newAgency?.id
    const trimmedName = data.companyName.trim()
    for (const clientId of ids) {
      const updates: { company_name: string; agency_id?: string } = { company_name: trimmedName }
      if (agencyId) updates.agency_id = agencyId
      const { error: clientError } = await q.updateClientCompanyAndAgency(supabase, clientId, updates)
      if (clientError) console.error('Failed to set client company_name/agency_id:', clientError)
    }

    revalidatePath('/pages/admin/agencies')
    return { error: null, data: { success: true } }
  } catch (err: any) {
    return { error: err?.message || 'Failed to create agency', data: null }
  }
}

export async function updateAgency(
  id: string,
  data: AgencyFormData,
  previousAgencyAdminIds: string[]
) {
  const supabase = await createClient()
  try {
    const newIds = (data.agencyAdminIds || []).filter(Boolean)
    const newSet = new Set(newIds)

    for (const clientId of newIds) {
      const { data: otherAgencies } = await q.getAgenciesExceptId(supabase, id)
      if (otherAgencies) {
        for (const ag of otherAgencies) {
          const arr = (ag.agency_admin_ids as string[]) || []
          if (arr.includes(clientId)) {
            const updated = arr.filter((x) => x !== clientId)
            await q.updateAgencyAdminIds(supabase, ag.id, updated)
            await q.updateClientClearAgency(supabase, clientId)
          }
        }
      }
    }

    const { error } = await q.updateAgencyById(supabase, id, {
      ...buildAgencyPayload(data),
      agency_admin_ids: newIds,
    })

    if (error) {
      return { error: error.message, data: null }
    }

    for (const clientId of previousAgencyAdminIds) {
      if (!newSet.has(clientId)) {
        await q.updateClientClearAgency(supabase, clientId)
      }
    }

    const trimmedName = data.companyName.trim()
    for (const clientId of newIds) {
      const { error: clientError } = await q.updateClientCompanyAndAgency(supabase, clientId, {
        company_name: trimmedName,
        agency_id: id,
      })
      if (clientError) console.error('Failed to set client company_name/agency_id:', clientError)
    }

    revalidatePath('/pages/admin/agencies')
    return { error: null, data: { success: true } }
  } catch (err: any) {
    return { error: err?.message || 'Failed to update agency', data: null }
  }
}

export type CompanyDetailsFormData = {
  companyName: string
  businessType: string
  taxId: string
  primaryLicenseNumber: string
  website?: string
  physicalStreetAddress: string
  physicalCity: string
  physicalState: string
  physicalZipCode: string
  sameAsPhysical: boolean
  mailingStreetAddress?: string
  mailingCity?: string
  mailingState?: string
  mailingZipCode?: string
}

export async function saveCompanyDetails(data: CompanyDetailsFormData) {
  const supabase = await createClient()
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) {
      return { error: 'Not authenticated', data: null }
    }

    const { data: client, error: clientError } = await q.getClientByCompanyOwnerId(supabase, user.id)

    if (clientError || !client) {
      return { error: 'No client record found for your account.', data: null }
    }

    const payload = {
      name: data.companyName.trim(),
      business_type: data.businessType.trim() || null,
      tax_id: data.taxId.trim() || null,
      primary_license_number: data.primaryLicenseNumber.trim() || null,
      website: data.website?.trim() || null,
      physical_street_address: data.physicalStreetAddress.trim() || null,
      physical_city: data.physicalCity.trim() || null,
      physical_state: data.physicalState.trim() || null,
      physical_zip_code: data.physicalZipCode.trim() || null,
      same_as_physical: data.sameAsPhysical ?? true,
      mailing_street_address: data.mailingStreetAddress?.trim() || null,
      mailing_city: data.mailingCity?.trim() || null,
      mailing_state: data.mailingState?.trim() || null,
      mailing_zip_code: data.mailingZipCode?.trim() || null,
      updated_at: new Date().toISOString(),
    }

    const { data: existingAgency } = await q.getAgencyByAdminId(supabase, client.id)

    if (existingAgency) {
      const { error: updateError } = await q.updateAgencyById(supabase, existingAgency.id, payload)

      if (updateError) {
        return { error: updateError.message, data: null }
      }
      await q.updateClientAgencyId(supabase, client.id, existingAgency.id)
    } else {
      const { data: newAgency, error: insertError } = await q.insertAgencyWithAdmin(supabase, {
        ...payload,
        agency_admin_ids: [client.id],
      })

      if (insertError) {
        return { error: insertError.message, data: null }
      }
      if (newAgency?.id) {
        await q.updateClientAgencyId(supabase, client.id, newAgency.id)
      }
    }

    const { error: clientUpdateError } = await q.updateClientCompanyName(supabase, client.id, data.companyName.trim())

    if (clientUpdateError) {
      console.error('Failed to update client company_name:', clientUpdateError)
    }

    revalidatePath('/pages/agency/profile')
    return { error: null, data: { success: true } }
  } catch (err: any) {
    return { error: err?.message || 'Failed to save company details', data: null }
  }
}
