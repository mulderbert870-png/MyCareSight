'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { createClient } from '@/lib/supabase/client'
import * as q from '@/lib/supabase/query'
import Modal from './Modal'
import { Loader2, Plus, Trash2 } from 'lucide-react'

const licenseSchema = z.object({
  license_type: z.string().min(1, 'License type is required'),
  license_number: z.string().min(1, 'License number is required'),
  state: z.string().optional(),
  expiry_date: z.string().optional(),
})

type LicenseFormData = z.infer<typeof licenseSchema>

interface StaffLicense {
  id: string
  license_type: string
  license_number: string
  state?: string | null
  status: string
  expiry_date?: string | null
  days_until_expiry?: number | null
}

interface ManageLicensesModalProps {
  isOpen: boolean
  onClose: () => void
  staffId: string
  staffName: string
  existingLicenses: StaffLicense[]
  onSuccess?: () => void
}

export default function ManageLicensesModal({
  isOpen,
  onClose,
  staffId,
  staffName,
  existingLicenses,
  onSuccess,
}: ManageLicensesModalProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<LicenseFormData>({
    resolver: zodResolver(licenseSchema),
  })

  const onSubmit = async (data: LicenseFormData) => {
    setIsLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      // Calculate days until expiry
      let daysUntilExpiry: number | null = null
      if (data.expiry_date) {
        const expiryDate = new Date(data.expiry_date)
        const today = new Date()
        const diffTime = expiryDate.getTime() - today.getTime()
        daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      }

      let status = 'approved'
      if (daysUntilExpiry !== null && daysUntilExpiry < 0) {
        status = 'rejected' // Use rejected to represent expired
      }

      const today = new Date()
      const todayStr = today.toISOString().split('T')[0]

      const { error: insertError } = await q.insertApplicationRow(supabase, {
        staff_member_id: staffId,
        company_owner_id: null,
        application_name: data.license_type,
        license_number: data.license_number,
        state: data.state || '',
        status: status,
        progress_percentage: 100,
        started_date: data.expiry_date ? new Date(data.expiry_date).toISOString().split('T')[0] : todayStr,
        last_updated_date: todayStr,
        submitted_date: todayStr,
        issue_date: data.expiry_date ? new Date(data.expiry_date).toISOString().split('T')[0] : null,
        expiry_date: data.expiry_date || null,
        days_until_expiry: daysUntilExpiry,
        issuing_authority: null,
      })

      if (insertError) {
        throw insertError
      }

      reset()
      setShowAddForm(false)
      router.refresh()

      if (onSuccess) {
        onSuccess()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to add license. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeleteLicense = async (licenseId: string) => {
    if (!confirm('Are you sure you want to delete this license?')) {
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      const { error: deleteError } = await q.deleteApplicationById(supabase, licenseId)

      if (deleteError) {
        throw deleteError
      }

      router.refresh()

      if (onSuccess) {
        onSuccess()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete license. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const formatDate = (date: string | Date | null) => {
    if (!date) return 'N/A'
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Manage Licenses - ${staffName}`} size="lg">
      <div className="space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
            {error}
          </div>
        )}

        {/* Existing Licenses */}
        <div>
          <h4 className="text-lg font-semibold text-gray-900 mb-4">Existing Licenses</h4>
          {existingLicenses.length === 0 ? (
            <p className="text-gray-500 text-sm">No licenses added yet.</p>
          ) : (
            <div className="space-y-3">
              {existingLicenses.map((license) => (
                <div key={license.id} className="p-4 bg-gray-50 rounded-lg flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-900">{license.license_type}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        license.status === 'active' ? 'bg-green-100 text-green-700' :
                        license.status === 'expired' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {license.status.charAt(0).toUpperCase() + license.status.slice(1)}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600">
                      {license.license_number}
                      {license.state && ` • ${license.state}`}
                    </div>
                    {license.expiry_date && (
                      <div className="text-sm text-gray-600 mt-1">
                        Expires: {formatDate(license.expiry_date)}
                        {license.days_until_expiry !== null && license.days_until_expiry !== undefined && (
                          <span className={`ml-2 font-semibold ${
                            license.days_until_expiry <= 30 ? 'text-orange-600' : 'text-gray-500'
                          }`}>
                            ({license.days_until_expiry} days remaining)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteLicense(license.id)}
                    disabled={isLoading}
                    className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add New License */}
        {!showAddForm ? (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-xl hover:border-gray-400 transition-colors flex items-center justify-center gap-2 text-gray-700 font-medium"
          >
            <Plus className="w-5 h-5" />
            Add New License
          </button>
        ) : (
          <div className="border-t border-gray-200 pt-6">
            <h4 className="text-lg font-semibold text-gray-900 mb-4">Add New License</h4>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label htmlFor="license_type" className="block text-sm font-semibold text-gray-700 mb-2">
                  License Type <span className="text-red-500">*</span>
                </label>
                <input
                  id="license_type"
                  type="text"
                  {...register('license_type')}
                  placeholder="e.g., RN License, BLS Certification"
                  className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  disabled={isLoading}
                />
                {errors.license_type && (
                  <p className="mt-1 text-sm text-red-600">{errors.license_type.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="license_number" className="block text-sm font-semibold text-gray-700 mb-2">
                    License Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="license_number"
                    type="text"
                    {...register('license_number')}
                    placeholder="RN-2024-12345"
                    className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                    disabled={isLoading}
                  />
                  {errors.license_number && (
                    <p className="mt-1 text-sm text-red-600">{errors.license_number.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="state" className="block text-sm font-semibold text-gray-700 mb-2">
                    State
                  </label>
                  <input
                    id="state"
                    type="text"
                    {...register('state')}
                    placeholder="Texas"
                    className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="expiry_date" className="block text-sm font-semibold text-gray-700 mb-2">
                  Expiry Date
                </label>
                <input
                  id="expiry_date"
                  type="date"
                  {...register('expiry_date')}
                  className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  disabled={isLoading}
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-6 py-2.5 bg-black text-white font-semibold rounded-xl hover:bg-gray-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Add License
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false)
                    reset()
                  }}
                  disabled={isLoading}
                  className="px-6 py-2.5 text-gray-700 font-medium rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Close Button */}
        <div className="flex justify-end pt-4 border-t border-gray-200">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-6 py-2.5 bg-black text-white font-semibold rounded-xl hover:bg-gray-800 transition-all disabled:opacity-50"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}

