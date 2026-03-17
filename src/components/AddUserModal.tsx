'use client'

import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createUserAccount, type CreateUserRole } from '@/app/actions/users'

interface AddUserModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
  agencies?: { id: string; name: string }[]
}

export default function AddUserModal({ isOpen, onClose, onSuccess, agencies = [] }: AddUserModalProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'company_owner' as CreateUserRole,
    agency_id: ''
  })

  const showAgencyField = formData.role === 'company_owner' || formData.role === 'staff_member'

  if (!isOpen) return null

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords don't match")
      setIsLoading(false)
      return
    }

    if (showAgencyField && !formData.agency_id?.trim()) {
      setError('Please select an agency.')
      setIsLoading(false)
      return
    }

    try {
      const result = await createUserAccount(
        formData.email,
        formData.password,
        formData.full_name,
        formData.role,
        showAgencyField ? formData.agency_id.trim() || null : null
      )

      if (result.error) {
        setError(result.error)
        setIsLoading(false)
        return
      }

      setFormData({ full_name: '', email: '', password: '', confirmPassword: '', role: 'company_owner', agency_id: '' })
      onSuccess?.()
      router.refresh()
      onClose()
    } catch (err) {
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Add User</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg" aria-label="Close">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="mb-2 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Full Name</label>
            <input
              name="full_name"
              value={formData.full_name}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              placeholder="Jane Doe"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Email Address</label>
            <input
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              placeholder="user@example.com"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Password</label>
              <input
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                placeholder="••••••••"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Confirm Password</label>
              <input
                name="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Role</label>
            <select name="role" value={formData.role} onChange={handleChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg">
              <option value="admin">Admin</option>
              <option value="company_owner">Agency Admin</option>
              <option value="staff_member">Caregiver</option>
              <option value="expert">Expert</option>
            </select>
          </div>

          {showAgencyField && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Agency <span className="text-red-500">*</span>
              </label>
              <select
                name="agency_id"
                value={formData.agency_id}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                required
              >
                <option value="">Select an agency</option>
                {agencies.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              {agencies.length === 0 && (
                <p className="mt-1 text-sm text-amber-600">No agencies available. Create one under Admin → Agencies first.</p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 mt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-white border rounded-lg">Cancel</button>
            <button type="submit" disabled={isLoading} className="px-4 py-2 bg-gray-900 text-white rounded-lg disabled:opacity-50">
              {isLoading ? 'Adding...' : (
                <span className="inline-flex items-center gap-2"><Plus className="w-4 h-4" /> Add User</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
