import type { Supabase } from '../types'

export async function getAgencyById(supabase: Supabase, agencyId: string) {
  return supabase.from('agencies').select('agency_admin_ids').eq('id', agencyId).single()
}

export async function insertAgency(supabase: Supabase, payload: Record<string, unknown>) {
  return supabase.from('agencies').insert(payload).select('id').single()
}

export async function updateClientCompanyAndAgency(
  supabase: Supabase,
  clientId: string,
  updates: { company_name: string; agency_id?: string }
) {
  return supabase.from('clients').update(updates).eq('id', clientId)
}

export async function getAgenciesExceptId(supabase: Supabase, excludeId: string) {
  return supabase.from('agencies').select('id, agency_admin_ids').neq('id', excludeId)
}

export async function updateAgencyAdminIds(supabase: Supabase, agencyId: string, agencyAdminIds: string[]) {
  return supabase
    .from('agencies')
    .update({ agency_admin_ids: agencyAdminIds, updated_at: new Date().toISOString() })
    .eq('id', agencyId)
}

export async function updateAgencyById(supabase: Supabase, id: string, payload: Record<string, unknown>) {
  return supabase.from('agencies').update(payload).eq('id', id)
}

export async function updateClientClearAgency(supabase: Supabase, clientId: string) {
  return supabase.from('clients').update({ company_name: '', agency_id: null }).eq('id', clientId)
}

export async function getClientByCompanyOwnerId(supabase: Supabase, companyOwnerId: string) {
  return supabase.from('clients').select('id').eq('company_owner_id', companyOwnerId).maybeSingle()
}

/** Get client id and agency_id by company_owner_id (for staff member creation). */
export async function getClientByCompanyOwnerIdWithAgency(supabase: Supabase, companyOwnerId: string) {
  return supabase
    .from('clients')
    .select('id, agency_id')
    .eq('company_owner_id', companyOwnerId)
    .single()
}

/** Get agency name by id. */
export async function getAgencyNameById(supabase: Supabase, agencyId: string) {
  return supabase.from('agencies').select('name').eq('id', agencyId).single()
}

/** Get client by id (full row). */
export async function getClientById(supabase: Supabase, clientId: string) {
  return supabase.from('clients').select('*').eq('id', clientId).single()
}

/** Update client by id (company_name, contact_*, status, etc.). */
export async function updateClientById(
  supabase: Supabase,
  clientId: string,
  data: Record<string, unknown>
) {
  return supabase.from('clients').update(data).eq('id', clientId)
}

export async function getAgencyByAdminId(supabase: Supabase, clientId: string) {
  return supabase.from('agencies').select('id').contains('agency_admin_ids', [clientId]).maybeSingle()
}

/** Get agency by admin (client) id, full row. */
export async function getAgencyByAdminIdFull(supabase: Supabase, clientId: string) {
  return supabase.from('agencies').select('*').contains('agency_admin_ids', [clientId]).maybeSingle()
}

export async function updateClientAgencyId(supabase: Supabase, clientId: string, agencyId: string) {
  return supabase.from('clients').update({ agency_id: agencyId }).eq('id', clientId)
}

export async function insertAgencyWithAdmin(supabase: Supabase, payload: Record<string, unknown>) {
  return supabase.from('agencies').insert(payload).select('id').single()
}

export async function updateClientCompanyName(supabase: Supabase, clientId: string, companyName: string) {
  return supabase.from('clients').update({ company_name: companyName }).eq('id', clientId)
}

/** Get all agencies ordered by created_at desc. */
export async function getAgenciesOrdered(supabase: Supabase) {
  return supabase.from('agencies').select('*').order('created_at', { ascending: false })
}

/** Get agencies for billing (id, name, agency_admin_ids) ordered by name. */
export async function getAgenciesForBilling(supabase: Supabase) {
  return supabase
    .from('agencies')
    .select('id, name, agency_admin_ids')
    .order('name', { ascending: true })
}

/** Get agencies id and name only, ordered by name (e.g. for dropdowns). */
export async function getAgenciesIdName(supabase: Supabase) {
  return supabase.from('agencies').select('id, name').order('name', { ascending: true })
}

/** Get clients that have company_owner_id (for agency admins list). */
export async function getClientsWithCompanyOwner(supabase: Supabase) {
  return supabase
    .from('clients')
    .select('id, contact_name, contact_email')
    .not('company_owner_id', 'is', null)
    .order('contact_name', { ascending: true })
}

/** Get all clients ordered by created_at desc. */
export async function getAllClientsOrdered(supabase: Supabase) {
  return supabase.from('clients').select('*').order('created_at', { ascending: false })
}

/** Get clients by ids (optional select). */
export async function getClientsByIds(supabase: Supabase, clientIds: string[], select = 'id, company_name') {
  if (clientIds.length === 0) return { data: [], error: null }
  return supabase.from('clients').select(select).in('id', clientIds)
}

/** Get clients by company_owner_ids (for user management). */
export async function getClientsByCompanyOwnerIds(
  supabase: Supabase,
  companyOwnerIds: string[],
  select = 'company_owner_id, company_name, agency_id'
) {
  if (companyOwnerIds.length === 0) return { data: [], error: null }
  return supabase.from('clients').select(select).in('company_owner_id', companyOwnerIds)
}
