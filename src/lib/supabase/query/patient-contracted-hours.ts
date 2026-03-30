import type { Supabase } from '../types'

/** UI shape for weekly contracted hours (backed by patient_service_contracts.contract_type = weekly_hours). */
export interface PatientContractedHoursRow {
  id: string
  patient_id: string
  total_hours: number
  effective_date: string
  end_date: string | null
  note: string | null
  created_at: string
  updated_at: string
}

function mapServiceContractToUi(row: {
  id: string
  patient_id: string
  weekly_hours_limit: number | string | null
  effective_date: string
  end_date: string | null
  note: string | null
  created_at: string
  updated_at: string
}): PatientContractedHoursRow {
  return {
    id: row.id,
    patient_id: row.patient_id,
    total_hours: Number(row.weekly_hours_limit ?? 0),
    effective_date: row.effective_date,
    end_date: row.end_date,
    note: row.note,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function getPatientAgencyId(supabase: Supabase, patientId: string): Promise<string | null> {
  const { data } = await supabase.from('patients').select('agency_id').eq('id', patientId).maybeSingle()
  return data?.agency_id ?? null
}

/** Get all weekly-hours contract limits for a patient, ordered by effective_date desc. */
export async function getPatientContractedHoursByPatientId(supabase: Supabase, patientId: string) {
  const { data, error } = await supabase
    .from('patient_service_contracts')
    .select('*')
    .eq('patient_id', patientId)
    .eq('contract_type', 'weekly_hours')
    .order('effective_date', { ascending: false })
  if (error) return { data: null, error }
  return {
    data: (data ?? []).map((r) => mapServiceContractToUi(r as Parameters<typeof mapServiceContractToUi>[0])),
    error: null,
  }
}

/** Insert a weekly-hours limit (patient_service_contracts). Returns UI-shaped row. */
export async function insertPatientContractedHours(
  supabase: Supabase,
  data: {
    patient_id: string
    total_hours: number
    effective_date: string
    end_date?: string | null
    note?: string | null
  }
) {
  const agencyId = await getPatientAgencyId(supabase, data.patient_id)
  if (!agencyId) {
    return {
      data: null,
      error: { message: 'Patient has no agency_id; cannot create service contract.', details: '', hint: '', code: '' },
    }
  }
  const { data: row, error } = await supabase
    .from('patient_service_contracts')
    .insert({
      agency_id: agencyId,
      patient_id: data.patient_id,
      contract_type: 'weekly_hours',
      service_type: 'non_skilled',
      bill_unit_type: 'hour',
      weekly_hours_limit: data.total_hours,
      effective_date: data.effective_date,
      end_date: data.end_date ?? null,
      note: data.note ?? null,
      status: 'active',
    })
    .select()
    .single()
  if (error || !row) return { data: null, error }
  return {
    data: mapServiceContractToUi(row as Parameters<typeof mapServiceContractToUi>[0]),
    error: null,
  }
}

/** Delete a weekly-hours contract row by id. */
export async function deletePatientContractedHours(supabase: Supabase, id: string) {
  return supabase
    .from('patient_service_contracts')
    .delete()
    .eq('id', id)
    .eq('contract_type', 'weekly_hours')
}

/** Active weekly-hours row covering date (effective_date <= date and open-ended or end_date >= date). */
export async function getActiveContractedHoursForDate(
  supabase: Supabase,
  patientId: string,
  date: string
): Promise<PatientContractedHoursRow | null> {
  const { data: rows } = await supabase
    .from('patient_service_contracts')
    .select('*')
    .eq('patient_id', patientId)
    .eq('contract_type', 'weekly_hours')
    .lte('effective_date', date)
    .or(`end_date.is.null,end_date.gte.${date}`)
    .order('effective_date', { ascending: false })
    .limit(1)
  const row = rows?.[0]
  return row ? mapServiceContractToUi(row as Parameters<typeof mapServiceContractToUi>[0]) : null
}
