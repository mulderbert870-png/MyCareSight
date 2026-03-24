import * as q from '@/lib/supabase/query'

type MinimalProfile = {
  role?: string | null
}

type SupabaseLike = Parameters<typeof q.getUserProfileFull>[0]

export function getEffectiveCompanyOwnerUserId(profile: MinimalProfile | null, userId: string): string | null {
  if (!profile?.role) return null
  if (profile.role === 'company_owner') return userId
  return null
}

export async function resolveEffectiveCompanyOwnerUserId(
  supabase: SupabaseLike,
  profile: MinimalProfile | null,
  userId: string
): Promise<string | null> {
  if (!profile?.role) return null

  if (profile.role === 'company_owner') {
    return userId
  }

  if (profile.role === 'care_coordinator') {
    const { data: coordinator } = await q.getCareCoordinatorByUserId(supabase, userId)
    if (!coordinator?.agency_id) return null

    const { data: agency } = await q.getAgencyById(supabase, coordinator.agency_id)
    const adminClientId = ((agency?.agency_admin_ids as string[] | null) ?? [])[0]
    if (!adminClientId) return null

    const { data: adminClient } = await q.getClientById(supabase, adminClientId)
    return adminClient?.company_owner_id ?? null
  }

  return null
}
