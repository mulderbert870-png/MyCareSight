'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import * as q from '@/lib/supabase/query'
import { resolveEffectiveCompanyOwnerUserId } from '@/lib/agency-scope'
import { appendCaregiverPayRateAction } from '@/app/actions/caregiver-pay-rates'
import { fetchPayrollBillingReportRows, type PayrollBillingDetailRow } from '@/lib/payroll-billing-report'

const REPORT_PATH = '/pages/agency/reports/payroll-billing'

async function getViewerAgencyId(): Promise<string | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await q.getUserProfileFull(supabase, user.id)
  const ownerId = await resolveEffectiveCompanyOwnerUserId(supabase, profile, user.id)
  if (!ownerId) return null
  const { data: ctx } = await q.getClientByCompanyOwnerIdWithAgency(supabase, ownerId)
  return ctx?.agency_id ?? null
}

export async function getPayrollBillingReportRowsAction(
  dateFrom: string,
  dateTo: string
): Promise<{ rows: PayrollBillingDetailRow[]; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { rows: [], error: 'Not signed in.' }

  const agencyId = await getViewerAgencyId()
  return fetchPayrollBillingReportRows(supabase, { agencyId, dateFrom, dateTo })
}

export type RateManagerPayRow = {
  id: string
  caregiver_member_id: string
  caregiverName: string
  service_type: string | null
  rate: number
  unit_type: string
  effective_start: string
  effective_end: string | null
}

export type RateManagerBillRow = {
  id: string
  patient_id: string
  clientName: string
  contract_name: string | null
  contract_type: string
  service_type: string
  bill_rate: number | null
  bill_unit_type: string
  effective_date: string
}

export async function getRateManagerDataAction(): Promise<{
  payRows: RateManagerPayRow[]
  billRows: RateManagerBillRow[]
  error?: string
}> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { payRows: [], billRows: [], error: 'Not signed in.' }

  const agencyId = await getViewerAgencyId()
  if (!agencyId) return { payRows: [], billRows: [], error: 'No agency context.' }

  const { data: payData, error: payErr } = await supabase
    .from('caregiver_pay_rates')
    .select('id, caregiver_member_id, service_type, pay_rate, unit_type, effective_start, effective_end')
    .eq('agency_id', agencyId)
    .is('effective_end', null)
    .order('effective_start', { ascending: false })

  if (payErr) return { payRows: [], billRows: [], error: payErr.message }

  const cgIds = Array.from(new Set((payData ?? []).map((r) => r.caregiver_member_id).filter(Boolean))) as string[]
  let nameByCg = new Map<string, string>()
  if (cgIds.length) {
    const { data: cgs } = await supabase
      .from('caregiver_members')
      .select('id, first_name, last_name')
      .in('id', cgIds)
    nameByCg = new Map(
      (cgs ?? []).map((c) => [c.id as string, [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Caregiver'])
    )
  }

  const payRows: RateManagerPayRow[] = (payData ?? [])
    .filter((r) => r.caregiver_member_id)
    .map((r) => ({
      id: r.id as string,
      caregiver_member_id: r.caregiver_member_id as string,
      caregiverName: nameByCg.get(r.caregiver_member_id as string) ?? 'Caregiver',
      service_type: (r.service_type as string | null) ?? null,
      rate: Number(r.pay_rate ?? 0),
      unit_type: String(r.unit_type ?? 'hour'),
      effective_start: String(r.effective_start ?? ''),
      effective_end: (r.effective_end as string | null) ?? null,
    }))

  const { data: billData, error: billErr } = await supabase
    .from('patient_service_contracts')
    .select('id, patient_id, contract_name, contract_type, service_type, bill_rate, bill_unit_type, effective_date, status')
    .eq('agency_id', agencyId)
    .eq('status', 'active')
    .neq('contract_type', 'weekly_hours')
    .order('effective_date', { ascending: false })

  if (billErr) return { payRows, billRows: [], error: billErr.message }

  const patientIds = Array.from(new Set((billData ?? []).map((r) => r.patient_id)))
  const { data: pats } =
    patientIds.length > 0
      ? await supabase.from('patients').select('id, full_name').in('id', patientIds)
      : { data: [] as { id: string; full_name: string | null }[] }

  const patientName = new Map((pats ?? []).map((p) => [p.id, p.full_name ?? 'Client']))

  const billRows: RateManagerBillRow[] = (billData ?? []).map((r) => ({
    id: r.id as string,
    patient_id: r.patient_id as string,
    clientName: patientName.get(r.patient_id as string) ?? 'Client',
    contract_name: (r.contract_name as string | null) ?? null,
    contract_type: String(r.contract_type ?? ''),
    service_type: String(r.service_type ?? ''),
    bill_rate: r.bill_rate != null ? Number(r.bill_rate) : null,
    bill_unit_type: String(r.bill_unit_type ?? 'hour'),
    effective_date: String(r.effective_date ?? ''),
  }))

  return { payRows, billRows }
}

/** Append a new caregiver pay rate row (closes the previous open row on the effective date). */
export async function updateCaregiverPayRateFromManagerAction(
  caregiverMemberId: string,
  serviceType: string | null,
  rate: number,
  effectiveDate?: string
): Promise<{ ok?: true; error?: string }> {
  const res = await appendCaregiverPayRateAction({
    caregiverMemberId,
    payRate: rate,
    effectiveDate,
    serviceType,
  })
  if (res.error) return { error: res.error }
  revalidatePath(REPORT_PATH)
  return { ok: true }
}

export async function updatePatientServiceContractBillRateAction(
  id: string,
  bill_rate: number
): Promise<{ ok?: true; error?: string }> {
  if (!Number.isFinite(bill_rate) || bill_rate < 0) return { error: 'Invalid bill rate.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('patient_service_contracts')
    .update({ bill_rate, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(REPORT_PATH)
  revalidatePath('/pages/agency/time-billing')
  return { ok: true }
}
