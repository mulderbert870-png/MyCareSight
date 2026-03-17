'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import * as q from '@/lib/supabase/query'

export async function toggleUserStatus(userId: string, isActive: boolean) {
  const supabase = await createClient()

  try {
    const { error } = await q.updateUserProfileUpdatedAt(supabase, userId)

    if (error) {
      return { error: error.message, data: null }
    }

    revalidatePath('/pages/admin/users')
    return { error: null, data: { success: true } }
  } catch (err: any) {
    return { error: err.message || 'Failed to update user status', data: null }
  }
}

export async function setUserPassword(userId: string, newPassword: string) {
  const supabase = await createClient()

  try {
    const { data: userProfile, error: fetchError } = await q.getUserProfileEmail(supabase, userId)

    if (fetchError || !userProfile) {
      return { error: 'User not found', data: null }
    }

    const { error: updateError } = await q.rpcUpdateUserPassword(supabase, userId, newPassword)

    if (updateError) {
      if (updateError.message.includes('could not find the function') || updateError.message.includes('does not exist')) {
        return {
          error: 'Database function not found. Please run the migration file 015_update_user_password_function.sql in Supabase SQL Editor first.',
          data: null,
        }
      }
      return { error: updateError.message, data: null }
    }

    revalidatePath('/pages/admin/users')
    return {
      error: null,
      data: {
        success: true,
        message: `Password has been set for ${userProfile.email}. Email notification should be sent separately.`,
      },
    }
  } catch (err: any) {
    return { error: err.message || 'Failed to set password', data: null }
  }
}

/** Role value for new users created from admin User Management */
export type CreateUserRole = 'admin' | 'company_owner' | 'staff_member' | 'expert'

function parseFullName(fullName: string): { first_name: string; last_name: string } {
  const trimmed = fullName.trim()
  if (!trimmed) return { first_name: 'User', last_name: 'Unknown' }
  const space = trimmed.indexOf(' ')
  if (space <= 0) return { first_name: trimmed, last_name: 'Unknown' }
  return {
    first_name: trimmed.slice(0, space),
    last_name: trimmed.slice(space + 1).trim() || 'Unknown',
  }
}

/** Ensure the role-specific table has a row for this user (idempotent). Used when user already exists. */
async function ensureRoleTableRow(
  supabaseAdmin: ReturnType<typeof createAdminClient>,
  userId: string,
  fullName: string,
  normalizedEmail: string,
  role: CreateUserRole
) {
  const { first_name: firstName, last_name: lastName } = parseFullName(fullName)
  if (role === 'company_owner') {
    const { data: existing } = await q.getClientByCompanyOwnerId(supabaseAdmin, userId)
    if (!existing) {
      await q.insertClient(supabaseAdmin, {
        company_owner_id: userId,
        contact_name: fullName || normalizedEmail,
        contact_email: normalizedEmail,
        status: 'pending',
      })
    }
  } else if (role === 'staff_member') {
    const { data: existing } = await q.getStaffMemberByUserId(supabaseAdmin, userId)
    if (!existing) {
      await q.insertStaffMember(supabaseAdmin, {
        user_id: userId,
        company_owner_id: null,
        first_name: firstName,
        last_name: lastName,
        email: normalizedEmail,
        role: 'Caregiver',
        status: 'active',
      })
    }
  } else if (role === 'expert') {
    const { data: existing } = await q.getLicensingExpertIdByUserId(supabaseAdmin, userId)
    if (!existing) {
      await q.insertLicensingExpert(supabaseAdmin, {
        user_id: userId,
        first_name: firstName,
        last_name: lastName,
        email: normalizedEmail,
        role: 'Licensing Specialist',
        status: 'active',
      })
    }
  }
}

/**
 * Create a user account from admin User Management. Uses Admin API so the current
 * admin's session is never overwritten (unlike signUp() which would log the admin out).
 * When role is company_owner or staff_member, agencyId is required and the user is assigned to that agency.
 */
export async function createUserAccount(
  email: string,
  password: string,
  fullName: string,
  role: CreateUserRole,
  agencyId?: string | null
) {
  let supabaseAdmin
  try {
    supabaseAdmin = createAdminClient()
  } catch (e: any) {
    return {
      error:
        e?.message ||
        'Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local for creating user accounts.',
      data: null,
    }
  }
  const supabaseCookie = await createClient()

  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    const normalizedEmail = email.toLowerCase().trim()

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName.trim(),
        role,
      },
    })

    let userId: string | null = null

    if (createError) {
      if (
        createError.message.includes('already registered') ||
        createError.message.includes('already exists') ||
        createError.message.includes('User already registered')
      ) {
        const { data: existingProfile } = await q.getUserProfileByEmail(supabaseAdmin, normalizedEmail)
        userId = existingProfile?.id || null
        if (userId) {
          await ensureRoleTableRow(supabaseAdmin, userId, fullName.trim(), normalizedEmail, role)
        }
        const { error: magicLinkError } = await supabaseCookie.auth.signInWithOtp({
          email: normalizedEmail,
          options: { emailRedirectTo: `${siteUrl}/auth/callback?type=magiclink` },
        })
        if (magicLinkError) {
          return { error: `User already exists. Failed to send login link: ${magicLinkError.message}`, data: null }
        }
        revalidatePath('/pages/admin/users')
        return {
          error: null,
          data: { success: true, userId, message: `User already exists. Login link sent to ${email}.` },
        }
      }
      const errorMessage =
        createError.message.includes('Database error') || createError.message.includes('database')
          ? 'Database error creating user. Ensure handle_new_user migration has been applied.'
          : createError.message
      return { error: `Failed to create user: ${errorMessage}`, data: null }
    }

    if (!newUser?.user?.id) {
      return { error: 'Failed to create user account - no user returned', data: null }
    }
    userId = newUser.user.id

    // Wait for handle_new_user trigger to create user_profiles
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Insert into role-specific table so the user appears in the right tab
    const fullNameTrimmed = fullName.trim()
    const { first_name: firstName, last_name: lastName } = parseFullName(fullNameTrimmed)

    if (role === 'company_owner') {
      const { data: newClient, error: clientError } = await supabaseAdmin
        .from('clients')
        .insert({
          company_owner_id: userId,
          contact_name: fullNameTrimmed || normalizedEmail,
          contact_email: normalizedEmail,
          status: 'pending',
          ...(agencyId ? { agency_id: agencyId } : {}),
        })
        .select('id')
        .single()
      if (clientError) {
        console.error('Failed to create clients row for agency admin:', clientError)
        return {
          error: `User created but failed to create agency record: ${clientError.message}`,
          data: null,
        }
      }
      if (agencyId && newClient?.id) {
        const { data: agency } = await supabaseAdmin.from('agencies').select('agency_admin_ids').eq('id', agencyId).single()
        const currentIds = (agency?.agency_admin_ids as string[] | null) || []
        if (!currentIds.includes(newClient.id)) {
          await supabaseAdmin
            .from('agencies')
            .update({ agency_admin_ids: [...currentIds, newClient.id], updated_at: new Date().toISOString() })
            .eq('id', agencyId)
        }
      }
    } else if (role === 'staff_member') {
      let companyOwnerId: string | null = null
      if (agencyId) {
        const { data: agency } = await supabaseAdmin.from('agencies').select('agency_admin_ids').eq('id', agencyId).single()
        const adminIds = (agency?.agency_admin_ids as string[] | null) || []
        if (adminIds.length > 0) companyOwnerId = adminIds[0]
      }
      const { error: staffError } = await supabaseAdmin
        .from('staff_members')
        .insert({
          user_id: userId,
          company_owner_id: companyOwnerId,
          agency_id: agencyId || null,
          first_name: firstName,
          last_name: lastName,
          email: normalizedEmail,
          role: 'Caregiver',
          status: 'active',
        })
      if (staffError) {
        console.error('Failed to create staff_members row for caregiver:', staffError)
        return {
          error: `User created but failed to create staff record: ${staffError.message}`,
          data: null,
        }
      }
    } else if (role === 'expert') {
      const { error: expertError } = await supabaseAdmin
        .from('licensing_experts')
        .insert({
          user_id: userId,
          first_name: firstName,
          last_name: lastName,
          email: normalizedEmail,
          role: 'Licensing Specialist',
          status: 'active',
        })
      if (expertError) {
        console.error('Failed to create licensing_experts row for expert:', expertError)
        return {
          error: `User created but failed to create expert record: ${expertError.message}`,
          data: null,
        }
      }
    }
    // admin role: no extra table

    const { error: magicLinkError } = await supabaseCookie.auth.signInWithOtp({
      email: normalizedEmail,
      options: { emailRedirectTo: `${siteUrl}/auth/callback?type=magiclink` },
    })
    if (magicLinkError) console.warn('Failed to send magic link:', magicLinkError.message)

    revalidatePath('/pages/admin/users')
    return {
      error: null,
      data: { success: true, userId, message: `User created. Login link sent to ${email}.` },
    }
  } catch (err: any) {
    return { error: err?.message || 'Failed to create user account', data: null }
  }
}

/** Build company_name for clients from work_location and optional job/department (no schema change). */
function buildAgencyAdminCompanyName(workLocation: string, jobTitle?: string, department?: string): string {
  const parts = [workLocation.trim()]
  if (jobTitle?.trim()) parts.push(`Job: ${jobTitle.trim()}`)
  if (department?.trim()) parts.push(`Dept: ${department.trim()}`)
  return parts.join(' | ') || 'Agency Admin'
}

/**
 * Create an agency admin: auth user (→ user_profiles via trigger) first, then clients row.
 * Sends magic link for first login. No table schema changes.
 */
export async function createAgencyAdminAccount(
  firstName: string,
  lastName: string,
  contactEmail: string,
  contactPhone: string,
  jobTitle: string | undefined,
  department: string | undefined,
  workLocation: string,
  status: 'active' | 'inactive' | 'pending' = 'active'
) {
  let supabaseAdmin
  try {
    supabaseAdmin = createAdminClient()
  } catch (e: any) {
    return {
      error:
        e?.message ||
        'Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local for creating agency admin accounts.',
      data: null,
    }
  }
  const supabaseCookie = await createClient()

  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    const normalizedEmail = contactEmail.toLowerCase().trim()
    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim() || normalizedEmail
    // const companyName = buildAgencyAdminCompanyName(workLocation, jobTitle, department)
    const defaultPassword = `${lastName.trim()}!123`

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password: defaultPassword,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role: 'company_owner',
      },
    })

    let userId: string | null = null

    if (createError) {
      if (
        createError.message.includes('already registered') ||
        createError.message.includes('already exists') ||
        createError.message.includes('User already registered')
      ) {
        const { data: existingProfile } = await supabaseAdmin
          .from('user_profiles')
          .select('id')
          .eq('email', normalizedEmail)
          .maybeSingle()
        userId = existingProfile?.id ?? null
        if (userId) {
          const { data: existingClient } = await supabaseAdmin
            .from('clients')
            .select('id')
            .eq('company_owner_id', userId)
            .maybeSingle()
          if (!existingClient) {
            await supabaseAdmin.from('clients').insert({
              company_owner_id: userId,
              // company_name: companyName,
              contact_name: fullName,
              contact_email: normalizedEmail,
              contact_phone: contactPhone.trim() || null,
              status,
            })
          }
        }
        const { error: magicLinkError } = await supabaseCookie.auth.signInWithOtp({
          email: normalizedEmail,
          options: { emailRedirectTo: `${siteUrl}/auth/callback?type=magiclink` },
        })
        if (magicLinkError) {
          return { error: `User already exists. Failed to send login link: ${magicLinkError.message}`, data: null }
        }
        revalidatePath('/pages/admin/users')
        return {
          error: null,
          data: { success: true, userId, message: `User already exists. Login link sent to ${contactEmail}.` },
        }
      }
      const errorMessage =
        createError.message.includes('Database error') || createError.message.includes('database')
          ? 'Database error creating user. Ensure handle_new_user migration has been applied.'
          : createError.message
      return { error: `Failed to create agency admin: ${errorMessage}`, data: null }
    }

    if (!newUser?.user?.id) {
      return { error: 'Failed to create agency admin - no user returned', data: null }
    }
    userId = newUser.user.id

    await new Promise((resolve) => setTimeout(resolve, 500))

    const { error: clientError } = await supabaseAdmin.from('clients').insert({
      company_owner_id: userId,
      // company_name: companyName,
      contact_name: fullName,
      contact_email: normalizedEmail,
      contact_phone: contactPhone.trim() || null,
      status,
    })
    if (clientError) {
      console.error('Failed to create clients row for agency admin:', clientError)
      return {
        error: `User created but failed to create agency record: ${clientError.message}`,
        data: null,
      }
    }

    const { error: magicLinkError } = await supabaseCookie.auth.signInWithOtp({
      email: normalizedEmail,
      options: { emailRedirectTo: `${siteUrl}/auth/callback?type=magiclink` },
    })
    if (magicLinkError) console.warn('Failed to send magic link:', magicLinkError.message)

    revalidatePath('/pages/admin/users')
    return {
      error: null,
      data: { success: true, userId, message: `Agency admin created. Login link sent to ${contactEmail}.` },
    }
  } catch (err: any) {
    return { error: err?.message || 'Failed to create agency admin account', data: null }
  }
}

export async function createStaffUserAccount(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
  agencyName?: string
) {
  // Use admin client for user creation so the current user's session is NEVER overwritten.
  // signUp() with the cookie-based client would set the new user's session and log out the agency admin.
  let supabaseAdmin
  try {
    supabaseAdmin = createAdminClient()
  } catch (e: any) {
    return {
      error:
        e?.message ||
        'Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local for creating staff accounts.',
      data: null,
    }
  }
  const supabaseCookie = await createClient()

  // For Supabase Magic Link email template: {{ .Data.agency_name }} and {{ .Data.temporary_password }}
  const userMetadata: Record<string, string> = {
    full_name: `${firstName} ${lastName}`,
    role: 'staff_member',
    agency_name: agencyName ?? 'Your Agency',
    temporary_password: password,
  }

  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    const normalizedEmail = email.toLowerCase().trim()

    // Create user via Admin API (no session change; never touches cookie client auth)
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    })

    let userId: string | null = null

    if (createError) {
      // User might already exist
      if (
        createError.message.includes('already registered') ||
        createError.message.includes('already exists') ||
        createError.message.includes('User already registered')
      ) {
        const { data: existingProfile } = await supabaseAdmin
          .from('user_profiles')
          .select('id')
          .eq('email', normalizedEmail)
          .single()

        userId = existingProfile?.id || null

        // Update existing user metadata so Magic Link email template has agency_name and temporary_password
        await supabaseAdmin.auth.admin.updateUserById(userId!, { user_metadata: userMetadata })

        // Send magic link using cookie client (only sends email; does not set session)
        const { error: magicLinkError } = await supabaseCookie.auth.signInWithOtp({
          email: normalizedEmail,
          options: {
            emailRedirectTo: `${siteUrl}/auth/callback?type=magiclink`,
          },
        })

        if (magicLinkError) {
          return {
            error: `User already exists. Failed to send login link: ${magicLinkError.message}`,
            data: null,
          }
        }

        return {
          error: null,
          data: {
            success: true,
            userId: userId,
            message: `User already exists. Login link sent to ${email}.`,
          },
        }
      }

      let errorMessage = createError.message
      if (
        createError.message.includes('Database error') ||
        createError.message.includes('database')
      ) {
        errorMessage =
          'Database error creating user account. Please ensure the database migration 033_fix_handle_new_user_for_staff_members.sql has been applied.'
      }
      return { error: `Failed to create user: ${errorMessage}`, data: null }
    }

    if (!newUser?.user) {
      return { error: 'Failed to create user account - no user returned', data: null }
    }

    userId = newUser.user.id

    if (!userId) {
      return { error: 'Failed to create user account - user ID is missing', data: null }
    }

    // Wait for handle_new_user trigger to create user_profiles
    await new Promise((resolve) => setTimeout(resolve, 500))

    let verifiedUserId = userId
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, role')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      console.warn('User profile not found after creation:', profileError)
      const { data: profileByEmail } = await supabaseAdmin
        .from('user_profiles')
        .select('id')
        .eq('email', normalizedEmail)
        .single()

      if (profileByEmail?.id) {
        verifiedUserId = profileByEmail.id
      }
    } else {
      verifiedUserId = profile.id
    }

    userId = verifiedUserId

    // Optional: send magic link via cookie client (sends email only; does not set session)
    const { error: magicLinkError } = await supabaseCookie.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback?type=magiclink`,
      },
    })
    if (magicLinkError) {
      console.warn('Failed to send magic link:', magicLinkError.message)
    }

    if (!userId) {
      return { error: 'Failed to get user ID after account creation', data: null }
    }

    return {
      error: null,
      data: {
        success: true,
        userId,
        message: `User account created. Login link sent to ${email}. Password: ${password}`,
      },
    }
  } catch (err: any) {
    return { error: err.message || 'Failed to create user account', data: null }
  }
}