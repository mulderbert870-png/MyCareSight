import { redirect } from 'next/navigation'

/** Reports are available to agency company owners and care coordinators only. */
export function assertAgencyReportsPageAccess(profile: { role?: string | null } | null) {
  if (profile?.role === 'admin') redirect('/pages/admin')
  if (profile?.role === 'expert') redirect('/pages/expert/clients')
  if (profile?.role !== 'company_owner' && profile?.role !== 'care_coordinator') {
    redirect('/pages/agency')
  }
}
