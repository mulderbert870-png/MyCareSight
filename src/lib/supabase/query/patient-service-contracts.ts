import type { Supabase } from '../types'

export type PatientServiceContractRow = {
  id: string
  patient_id: string
  contract_name: string | null
  contract_type: string
  service_type: 'non_skilled' | 'skilled'
  bill_rate: number | null
  bill_unit_type: 'hour' | 'visit' | '15_min_unit'
  weekly_hours_limit: number | null
  effective_date: string
  end_date: string | null
  status: string
  note: string | null
  created_at: string
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

  // only one active contract per service_type
  await supabase
    .from('patient_service_contracts')
    .update({ status: 'inactive' })
    .eq('patient_id', data.patient_id)
    .eq('service_type', data.service_type)
    .eq('status', 'active')

  return supabase
    .from('patient_service_contracts')
    .insert({
      agency_id: agencyId,
      patient_id: data.patient_id,
      contract_name: data.contract_name ?? null,
      contract_type: data.contract_type,
      service_type: data.service_type,
      bill_rate: data.bill_rate ?? null,
      bill_unit_type: data.bill_unit_type,
      weekly_hours_limit: data.weekly_hours_limit ?? null,
      effective_date: data.effective_date,
      end_date: data.end_date ?? null,
      status: 'active',
      note: data.note ?? null,
    })
    .select('*')
    .single()
}
