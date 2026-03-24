/**
 * Agency admin UI is keyed by the company owner's auth user id (patients.owner_id, clients.company_owner_id).
 * Care coordinators use user_profiles.managed_company_owner_id to reference that same id.
 */

export type AgencyScopedProfile = {
  role?: string | null
  managed_company_owner_id?: string | null
} | null

export function getEffectiveCompanyOwnerUserId(
  profile: AgencyScopedProfile,
  sessionUserId: string
): string | null {
  if (!profile?.role) return sessionUserId
  if (profile.role === 'care_coordinator') {
    return profile.managed_company_owner_id ?? null
  }
  return sessionUserId
}

/** Routes a care coordinator may open (sidebar only shows Clients + Caregivers; profile via header). */
export function careCoordinatorAllowedPath(pathname: string | null): boolean {
  if (!pathname) return true
  if (pathname === '/pages/agency/clients' || pathname.startsWith('/pages/agency/clients/')) return true
  if (pathname === '/pages/agency/caregiver' || pathname.startsWith('/pages/agency/caregiver/')) return true
  if (pathname === '/pages/agency/profile') return true
  return false
}
