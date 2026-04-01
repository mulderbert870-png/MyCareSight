import type { Supabase } from '../types'

export type SkilledCarePlanTask = {
  id: string
  patient_id: string
  task_id: string
  category: string
  name: string
  description: string | null
  display_order: number
}

type SkilledTaskRow = {
  id: string
  patient_id: string
  task_id: string | null
  display_order: number | null
  task_catalog:
    | {
        category: string | null
        name: string | null
        description: string | null
      }
    | {
        category: string | null
        name: string | null
        description: string | null
      }[]
    | null
}

function firstCatalog(
  v: SkilledTaskRow['task_catalog']
): { category: string | null; name: string | null; description: string | null } | null {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

type CatalogRow = {
    category: string | null
    name: string | null
    description: string | null
  }

async function requireAgencyIdForPatient(supabase: Supabase, patientId: string): Promise<string> {
  const { data } = await supabase.from('patients').select('agency_id').eq('id', patientId).maybeSingle()
  if (!data?.agency_id) throw new Error('Patient has no agency_id')
  return data.agency_id
}

export async function getPatientSkilledCarePlanTasks(supabase: Supabase, patientId: string) {
  const { data, error } = await supabase
    .from('patient_care_plan_tasks')
    .select('id, patient_id, task_id, display_order, task_catalog(category, name, description)')
    .eq('patient_id', patientId)
    .eq('service_type', 'skilled')
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return { data: null, error }
  const mapped = ((data ?? []) as SkilledTaskRow[])
    .map((r) => ({ r, c: firstCatalog(r.task_catalog) as CatalogRow | null }))
    .filter(({ r, c }) => !!r.task_id && !!c?.name)
    .map(({ r, c }) => ({
      id: r.id,
      patient_id: r.patient_id,
      task_id: r.task_id as string,
      category: (c?.category ?? 'General').trim() || 'General',
      name: (c?.name ?? '').trim(),
      description: c?.description ?? null,
      display_order: r.display_order ?? 0,
    }))
  return { data: mapped, error: null }
}

export async function replacePatientSkilledCarePlanTasks(
  supabase: Supabase,
  patientId: string,
  taskIds: string[]
) {
  const agencyId = await requireAgencyIdForPatient(supabase, patientId)

  const { error: deleteError } = await supabase
    .from('patient_care_plan_tasks')
    .delete()
    .eq('patient_id', patientId)
    .eq('service_type', 'skilled')
  if (deleteError) return { data: null, error: deleteError }

  if (taskIds.length === 0) return { data: [], error: null }

  const rows = taskIds.map((taskId, i) => ({
    agency_id: agencyId,
    patient_id: patientId,
    task_id: taskId,
    day_of_week: 1,
    schedule_type: 'always',
    service_type: 'skilled',
    display_order: i,
  }))
  const { error: insertError } = await supabase.from('patient_care_plan_tasks').insert(rows)
  if (insertError) return { data: null, error: insertError }

  return getPatientSkilledCarePlanTasks(supabase, patientId)
}
