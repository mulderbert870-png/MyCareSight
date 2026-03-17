'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import Modal from './Modal'
import { MapPin } from 'lucide-react'
import { US_STATES } from '@/lib/constants'

const stateSchema = z.object({
  state: z.string().min(1, 'State is required'),
})

type StateFormData = z.infer<typeof stateSchema>

interface NewLicenseApplicationModalProps {
  isOpen: boolean
  onClose: () => void
  onStateSelect?: (state: string) => void
}

export default function NewLicenseApplicationModal({ 
  isOpen, 
  onClose, 
  onStateSelect 
}: NewLicenseApplicationModalProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<StateFormData>({
    resolver: zodResolver(stateSchema),
  })

  const onSubmit = async (data: StateFormData) => {
    setIsLoading(true)
    setError(null)

    try {
      // If onStateSelect callback is provided, use it (for multi-step modal flow)
      if (onStateSelect) {
        onStateSelect(data.state)
        reset()
        setIsLoading(false)
        return
      }

      // Otherwise, navigate to the new license page with state parameter
      router.push(`/pages/agency/licenses/new?state=${encodeURIComponent(data.state)}`)
      reset()
      onClose()
    } catch (err: any) {
      setError(err.message || 'An error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    if (!isLoading) {
      reset()
      setError(null)
      onClose()
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Select State for License Application" size="md">
      <div className="space-y-6">
        {/* Description */}
        <p className="text-gray-600 text-base">
          Choose the state where you want to apply for a home care license.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          {/* State Field */}
          <div>
            <label htmlFor="state" className="block text-sm font-semibold text-gray-700 mb-2">
              State
            </label>
            <div className="relative">
              <select
                id="state"
                {...register('state')}
                className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white appearance-none pr-10"
                disabled={isLoading}
              >
                <option value="">Select a state...</option>
                {US_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                <svg
                  className="w-5 h-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </div>
            {errors.state && (
              <p className="mt-1 text-sm text-red-600">{errors.state.message}</p>
            )}
          </div>

          {/* Informational Note */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
            <MapPin className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-blue-900 mb-1">Note:</p>
              <p className="text-sm text-blue-800">
                Each state has different license types and requirements. After selecting your state, you&apos;ll see available license options.
              </p>
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={handleClose}
              disabled={isLoading}
              className="px-6 py-2.5 text-gray-700 font-medium rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-6 py-2.5 bg-black text-white font-semibold rounded-xl hover:bg-gray-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Loading...' : 'Continue'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}

