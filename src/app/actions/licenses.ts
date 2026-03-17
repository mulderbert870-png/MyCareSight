'use server'

import { revalidatePath } from 'next/cache'

/**
 * Revalidate the dashboard licenses page so the license list refetches after create/update.
 */
export async function revalidateLicensesPage() {
  revalidatePath('/pages/agency/licenses')
}
