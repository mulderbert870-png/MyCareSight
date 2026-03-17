import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { type NextRequest } from 'next/server'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const type = requestUrl.searchParams.get('type') // 'signup', 'recovery', 'magiclink', etc.

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error && data.session) {
      // Successfully authenticated - get user email for login page
      const { data: { user } } = await supabase.auth.getUser()
      
      const userEmail = user?.email || ''
      
      // Create redirect URL to login page first
      // Add 'from_callback' parameter to prevent middleware from redirecting
      const loginUrl = new URL('/pages/auth/login', requestUrl.origin)
      loginUrl.searchParams.set('message', 'Account activated successfully! Please sign in with your email and password.')
      loginUrl.searchParams.set('from_callback', 'true')
      if (userEmail) {
        loginUrl.searchParams.set('email', userEmail)
      }
      
      // Sign out and get the response (which will have cleared cookies)
      const { error: signOutError } = await supabase.auth.signOut()
      
      // Create redirect response
      const response = NextResponse.redirect(loginUrl)
      
      // Force clear all possible auth cookies by setting them to empty with past expiry
      // This ensures no session cookies remain
      const cookieStore = await cookies()
      const allCookies = cookieStore.getAll()
      
      allCookies.forEach((cookie) => {
        const cookieName = cookie.name.toLowerCase()
        // Clear any Supabase-related cookies
        if (cookieName.includes('sb-') || 
            cookieName.includes('supabase') ||
            cookieName.includes('auth') ||
            cookieName.includes('access') ||
            cookieName.includes('refresh')) {
          // Delete the cookie
          response.cookies.delete(cookie.name)
          // Also set it to expire in the past
          response.cookies.set(cookie.name, '', {
            expires: new Date(0),
            path: '/',
            maxAge: 0,
          })
        }
      })
      
      return response
    }

    // If it's a signup confirmation (type=signup) but no session, redirect to login
    if (type === 'signup' && error) {
      const url = new URL('/pages/auth/login', requestUrl.origin)
      url.searchParams.set('message', 'Email confirmed successfully. Please sign in.')
      return NextResponse.redirect(url)
    }

    // PKCE error: magic link was sent from server (e.g. when agency admin added a caregiver),
    // so the recipient's browser never had the code verifier. Don't show the raw error—
    // they can still sign in with email/password.
    const isPkceError =
      error?.message?.includes('PKCE') ||
      error?.message?.toLowerCase().includes('code verifier')
    if (error && isPkceError) {
      const url = new URL('/pages/auth/login', requestUrl.origin)
      url.searchParams.set('message', 'Please sign in with your email and password below.')
      return NextResponse.redirect(url)
    }

    // Other magic link / callback errors: show error
    if (error) {
      const url = new URL('/pages/auth/login', requestUrl.origin)
      url.searchParams.set('error', error.message || 'Failed to activate account. Please try again.')
      return NextResponse.redirect(url)
    }
  }

  // If there's no code or other error, redirect to login with error message
  const url = new URL('/pages/auth/login', requestUrl.origin)
  url.searchParams.set('error', 'Invalid authentication link. Please try again.')
  return NextResponse.redirect(url)
}

