import type { Supabase } from '../types'

/** Insert a patient and return the result. */
export async function insertPatient(
  supabase: Supabase,
  data: Record<string, unknown>
) {
  return supabase.from('patients').insert(data)
}

/** Get patients by owner_id. */
export async function getPatientsByOwnerId(supabase: Supabase, ownerId: string) {
  return supabase
  .from('patients')
  .select(`
    *,
    patients_representatives (
      id,
      name,
      relationship,
      phone_number,
      email_address
    )
  `)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
}

/** Get patients by owner_id list (agency-wide), ordered by created_at desc. */
export async function getPatientsByOwnerIds(supabase: Supabase, ownerIds: string[]) {
  if (ownerIds.length === 0) return { data: [], error: null }
  return supabase
    .from('patients')
    .select(`
    *,
    patients_representatives (
      id,
      name,
      relationship,
      phone_number,
      email_address
    )
  `)
    .in('owner_id', ownerIds)
    .order('created_at', { ascending: false })
}

/** Get patients by agency_id, ordered by created_at desc. */
export async function getPatientsByAgencyId(supabase: Supabase, agencyId: string) {
  return supabase
    .from('patients')
    .select(`
    *,
    patients_representatives (
      id,
      name,
      relationship,
      phone_number,
      email_address
    )
  `)
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false })
}

/** Update patient status by id. */
export async function updatePatientStatus(
  supabase: Supabase,
  patientId: string,
  status: string
) {
  return supabase.from('patients').update({ status }).eq('id', patientId)
}

/** Update patient login_access by id. */
export async function updatePatientLoginAccess(
  supabase: Supabase,
  patientId: string,
  loginAccess: boolean
) {
  return supabase.from('patients').update({ login_access: loginAccess }).eq('id', patientId)
}

/** Update patient fields (e.g. personal info) by id. */
export async function updatePatient(
  supabase: Supabase,
  patientId: string,
  data: { full_name?: string; gender?: string | null; date_of_birth?: string }
) {
  return supabase.from('patients').update(data).eq('id', patientId)
}

/** Update patient medical fields by id. */
export async function updatePatientMedical(
  supabase: Supabase,
  patientId: string,
  data: { primary_diagnosis?: string | null; current_medications?: string | null; allergies?: string | null }
) {
  return supabase.from('patients').update(data).eq('id', patientId)
}

/** Document item stored in patients.documents JSONB. */
export type PatientDocument = {
  id: string
  name: string
  path: string
  url?: string
  uploaded_at: string
  size?: number
}

/** Update patient documents (JSONB array). Returns updated row or error. */
export async function updatePatientDocuments(
  supabase: Supabase,
  patientId: string,
  documents: PatientDocument[]
) {
  return supabase
    .from('patients')
    .update({ documents })
    .eq('id', patientId)
    .select()
    .single()
}

/** Get patient by id and owner_id (for detail page). */
export async function getPatientByIdAndOwnerId(
  supabase: Supabase,
  patientId: string,
  ownerId: string
) {
  return supabase
  .from('patients')
  .select(`
    *,
    patients_representatives (
      id,
      name,
      relationship,
      phone_number,
      email_address
    )
  `)
    .eq('id', patientId)
    .eq('owner_id', ownerId)
    
    .single()
}

/** Get patient by id and owner_id list (agency-wide detail page access). */
export async function getPatientByIdAndOwnerIds(
  supabase: Supabase,
  patientId: string,
  ownerIds: string[]
) {
  if (ownerIds.length === 0) return { data: null, error: null }
  return supabase
    .from('patients')
    .select(`
    *,
    patients_representatives (
      id,
      name,
      relationship,
      phone_number,
      email_address
    )
  `)
    .eq('id', patientId)
    .in('owner_id', ownerIds)
    .maybeSingle()
}

/** Get patient by id and agency_id (agency-wide detail page access). */
export async function getPatientByIdAndAgencyId(
  supabase: Supabase,
  patientId: string,
  agencyId: string
) {
  return supabase
    .from('patients')
    .select(`
    *,
    patients_representatives (
      id,
      name,
      relationship,
      phone_number,
      email_address
    )
  `)
    .eq('id', patientId)
    .eq('agency_id', agencyId)
    .maybeSingle()
}

/** Get patients by owner_id (id, full_name) for lists/navigation, ordered by full_name. */
export async function getPatientsByOwnerIdMinimal(supabase: Supabase, ownerId: string) {
  return supabase
    .from('patients')
    .select('id, full_name')
    .eq('owner_id', ownerId)
    .order('full_name', { ascending: true })
}

/** Get patients by owner_id list (id, full_name), ordered by full_name. */
export async function getPatientsByOwnerIdsMinimal(supabase: Supabase, ownerIds: string[]) {
  if (ownerIds.length === 0) return { data: [], error: null }
  return supabase
    .from('patients')
    .select('id, full_name')
    .in('owner_id', ownerIds)
    .order('full_name', { ascending: true })
}

/** Get patients by agency_id (id, full_name), ordered by full_name. */
export async function getPatientsByAgencyIdMinimal(supabase: Supabase, agencyId: string) {
  return supabase
    .from('patients')
    .select('id, full_name')
    .eq('agency_id', agencyId)
    .order('full_name', { ascending: true })
}
