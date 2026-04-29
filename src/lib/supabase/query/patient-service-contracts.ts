import type { Supabase } from '../types'

export type PatientServiceContractRow = {
  id: string
  patient_id: string
  contract_name: string | null
  contract_type: string
  service_type: 'non_skilled' | 'skilled'
  billing_code_id: string | null
  bill_rate: number | null
  bill_unit_type: 'hour' | 'visit' | '15_min_unit'
  weekly_hours_limit: number | null
  effective_date: string
  end_date: string | null
  status: string
  note: string | null
  created_at: string
  updated_at?: string
}

async function getPatientAgencyId(supabase: Supabase, patientId: string): Promise<string | null> {
  const { data } = await supabase.from('patients').select('agency_id').eq('id', patientId).maybeSingle()
  return data?.agency_id ?? null
}

export async function getPatientServiceContractsByPatientId(supabase: Supabase, patientId: string) {
  return supabase
    .from('patient_service_contracts')
    .select('*')
    .eq('patient_id', patientId)
    .order('effective_date', { ascending: false })
    .order('created_at', { ascending: false })
}

export async function insertPatientServiceContract(
  supabase: Supabase,
  data: {
    patient_id: string
    contract_name?: string | null
    contract_type: string
    service_type: 'non_skilled' | 'skilled'
    billing_code_id?: string | null
    bill_rate?: number | null
    bill_unit_type: 'hour' | 'visit' | '15_min_unit'
    weekly_hours_limit?: number | null
    effective_date: string
    end_date?: string | null
    note?: string | null
  }
) {
  const agencyId = await getPatientAgencyId(supabase, data.patient_id)
  if (!agencyId) return { data: null, error: { message: 'Patient has no agency_id' } }
  const { data: insertedId, error: insertErr } = await supabase.rpc('append_patient_service_contract', {
    p_agency_id: agencyId,
    p_patient_id: data.patient_id,
    p_contract_name: data.contract_name ?? null,
    p_contract_type: data.contract_type,
    p_service_type: data.service_type,
    p_billing_code_id: data.billing_code_id ?? null,
    p_bill_rate: data.bill_rate ?? null,
    p_bill_unit_type: data.bill_unit_type,
    p_weekly_hours_limit: data.weekly_hours_limit ?? null,
    p_effective_date: data.effective_date,
    p_end_date: data.end_date ?? null,
    p_note: data.note ?? null,
  })
  if (insertErr) return { data: null, error: insertErr }
  if (!insertedId) return { data: null, error: { message: 'Insert did not return row id' } }

  return supabase.from('patient_service_contracts').select('*').eq('id', insertedId).single()
}
