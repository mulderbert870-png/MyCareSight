'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Lock, ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { createImplicitClient } from '@/lib/supabase/client-implicit'
import * as q from '@/lib/supabase/query'
import Link from 'next/link'

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string().min(6, 'Please confirm your password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from current password",
    path: ['newPassword'],
  })

const recoveryPasswordSchema = z
  .object({
    newPassword: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string().min(6, 'Please confirm your password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  })

type ChangePasswordFormData = z.infer<typeof changePasswordSchema>
type RecoveryPasswordFormData = z.infer<typeof recoveryPasswordSchema>

export default function ChangePasswordPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isRecoveryMode, setIsRecoveryMode] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
  })

  const recoveryForm = useForm<RecoveryPasswordFormData>({
    resolver: zodResolver(recoveryPasswordSchema),
  })

  // Check if user is authenticated: recovery (hash) uses implicit client; otherwise cookie client
  useEffect(() => {
    const checkAuth = async () => {
      const hasRecoveryHash =
        typeof window !== 'undefined' && window.location.hash?.includes('access_token')

      if (hasRecoveryHash) {
        // Reset link opened (possibly in another browser): session is in URL fragment
        const supabase = createImplicitClient()
        let session = (await supabase.auth.getSession()).data.session
        if (!session) {
          await new Promise((r) => setTimeout(r, 300))
          session = (await supabase.auth.getSession()).data.session
        }
        if (session?.user) {
          setIsRecoveryMode(true)
          setUserRole(null)
          setIsAuthenticated(true)
          return
        }
      }

      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/pages/auth/login')
      } else {
        const { data: profile } = await q.getUserProfileRoleById(supabase, user.id)
        setUserRole(profile?.role || null)
        setIsAuthenticated(true)
      }
    }
    checkAuth()
  }, [router])

  const onSubmit = async (data: ChangePasswordFormData) => {
    setIsLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const supabase = createClient()

      // First, verify the current password by attempting to sign in
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !user.email) {
        setError('User not found. Please log in again.')
        setIsLoading(false)
        return
      }

      // Verify current password
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: data.currentPassword,
      })

      if (signInError) {
        setError('Current password is incorrect')
        setIsLoading(false)
        return
      }

      // Update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: data.newPassword,
      })

      if (updateError) {
        setError(updateError.message)
        setIsLoading(false)
        return
      }

      setSuccess(true)
      setIsLoading(false)

      // Redirect after 2 seconds based on user role
      setTimeout(() => {
        let redirectPath = '/pages/agency'
        
        if (userRole === 'admin') {
          redirectPath = '/pages/admin'
        } else if (userRole === 'expert') {
          redirectPath = '/pages/expert/clients'
        } else if (userRole === 'staff_member') {
          redirectPath = '/pages/caregiver'
        }
        
        router.push(redirectPath)
      }, 2000)
    } catch (err) {
      setError('An unexpected error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  const onRecoverySubmit = async (data: RecoveryPasswordFormData) => {
    setIsLoading(true)
    setError(null)
    setSuccess(false)
    try {
      const supabase = createImplicitClient()
      const { error: updateError } = await supabase.auth.updateUser({
        password: data.newPassword,
      })
      if (updateError) {
        setError(updateError.message)
        setIsLoading(false)
        return
      }
      setSuccess(true)
      setIsLoading(false)
      setTimeout(() => {
        router.push('/pages/auth/login?message=Password updated. Please sign in with your new password.')
      }, 2000)
    } catch (err) {
      setError('An unexpected error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center p-4 py-8 sm:py-12">
      <div className="w-full max-w-md">
        {/* Logo and Title */}
        <div className="text-center mb-6 sm:mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl shadow-lg mb-3 sm:mb-4">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">
            {isRecoveryMode ? 'Set new password' : 'Change Password'}
          </h1>
          <p className="text-sm sm:text-base text-gray-600">
            {isRecoveryMode ? 'Enter your new password below.' : 'Update your account password'}
          </p>
        </div>

        <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl p-6 sm:p-8 border border-gray-100">
          {isRecoveryMode ? (
            <form onSubmit={recoveryForm.handleSubmit(onRecoverySubmit)} className="space-y-6">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                  {error}
                </div>
              )}
              {success && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl text-sm">
                  Password updated successfully! Redirecting to sign in...
                </div>
              )}
              <div>
                <label htmlFor="recovery-newPassword" className="block text-sm font-semibold text-gray-700 mb-2">
                  New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="recovery-newPassword"
                    type="password"
                    {...recoveryForm.register('newPassword')}
                    placeholder="Enter new password"
                    className="block w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  />
                </div>
                {recoveryForm.formState.errors.newPassword && (
                  <p className="mt-1 text-sm text-red-600">
                    {recoveryForm.formState.errors.newPassword.message}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-500">Must be at least 6 characters</p>
              </div>
              <div>
                <label htmlFor="recovery-confirmPassword" className="block text-sm font-semibold text-gray-700 mb-2">
                  Confirm New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="recovery-confirmPassword"
                    type="password"
                    {...recoveryForm.register('confirmPassword')}
                    placeholder="Confirm new password"
                    className="block w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  />
                </div>
                {recoveryForm.formState.errors.confirmPassword && (
                  <p className="mt-1 text-sm text-red-600">
                    {recoveryForm.formState.errors.confirmPassword.message}
                  </p>
                )}
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-gray-900 to-gray-800 text-white py-3.5 rounded-xl font-semibold hover:from-gray-800 hover:to-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              >
                {isLoading ? 'Updating...' : 'Set password'}
              </button>
              <div className="mt-6 text-center">
                <Link href="/pages/auth/login" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 font-medium">
                  <ArrowLeft className="w-4 h-4" />
                  Back to sign in
                </Link>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                  {error}
                </div>
              )}
              {success && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl text-sm">
                  Password updated successfully! Redirecting...
                </div>
              )}
              <div>
                <label htmlFor="currentPassword" className="block text-sm font-semibold text-gray-700 mb-2">
                  Current Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="currentPassword"
                    type="password"
                    {...register('currentPassword')}
                    placeholder="Enter current password"
                    className="block w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  />
                </div>
                {errors.currentPassword && (
                  <p className="mt-1 text-sm text-red-600">
                    {errors.currentPassword.message}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="newPassword" className="block text-sm font-semibold text-gray-700 mb-2">
                  New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="newPassword"
                    type="password"
                    {...register('newPassword')}
                    placeholder="Enter new password"
                    className="block w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  />
                </div>
                {errors.newPassword && (
                  <p className="mt-1 text-sm text-red-600">
                    {errors.newPassword.message}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-500">Must be at least 6 characters</p>
              </div>
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-semibold text-gray-700 mb-2">
                  Confirm New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="confirmPassword"
                    type="password"
                    {...register('confirmPassword')}
                    placeholder="Confirm new password"
                    className="block w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  />
                </div>
                {errors.confirmPassword && (
                  <p className="mt-1 text-sm text-red-600">
                    {errors.confirmPassword.message}
                  </p>
                )}
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-gray-900 to-gray-800 text-white py-3.5 rounded-xl font-semibold hover:from-gray-800 hover:to-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              >
                {isLoading ? 'Updating...' : 'Update Password'}
              </button>
              <div className="mt-6 text-center">
                <Link 
                  href={userRole === 'admin' ? '/pages/admin' : userRole === 'expert' ? '/pages/expert/clients' : userRole === 'staff_member' ? '/pages/caregiver' : '/pages/agency'} 
                  className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 font-medium"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to Dashboard
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

