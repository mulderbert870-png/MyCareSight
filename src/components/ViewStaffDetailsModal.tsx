'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Mail, Phone, Award, MoreVertical, AlertTriangle } from 'lucide-react'

interface StaffMember {
  id: string
  first_name: string
  last_name: string
  email: string
  phone?: string | null
  role: string
  job_title?: string | null
  status: string
  employee_id?: string | null
  start_date?: string | null
  created_at?: string
}

interface StaffLicense {
  id: string
  license_type: string
  license_number: string
  state?: string | null
  status: string
  expiry_date?: string | null
  days_until_expiry?: number | null
}

interface ViewStaffDetailsModalProps {
  isOpen: boolean
  onClose: () => void
  staff: StaffMember
  licenses: StaffLicense[]
}

export default function ViewStaffDetailsModal({
  isOpen,
  onClose,
  staff,
  licenses,
}: ViewStaffDetailsModalProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    if (isOpen) {
      window.addEventListener('keydown', handleEscape)
    }
    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false)
      }
    }

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isMenuOpen])

  const formatDate = (date: string | Date | null) => {
    if (!date) return 'N/A'
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase()
  }

  const activeLicenses = licenses.filter(l => l.status === 'active')
  const expiringLicensesCount = licenses.filter(l => {
    if (l.days_until_expiry) {
      return l.days_until_expiry <= 60 && l.days_until_expiry > 0
    }
    return false
  }).length

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-5001 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Close Button and Three Dots */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-end gap-2 rounded-t-xl z-10">
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6">
          {/* Staff Header Section */}
          <div className="flex items-start gap-4 mb-6">
            {/* Avatar */}
            <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-xl flex-shrink-0">
              {getInitials(staff.first_name, staff.last_name)}
            </div>

            {/* Staff Info */}
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <h3 className="text-xl font-bold text-gray-900">
                  {staff.first_name} {staff.last_name}
                </h3>
                <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                  Active
                </span>
                {expiringLicensesCount > 0 && (
                  <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-semibold flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {expiringLicensesCount} License{expiringLicensesCount > 1 ? 's' : ''} Expiring
                  </span>
                )}
              </div>
              <p className="text-gray-600 text-sm">{staff.role}</p>
            </div>
          </div>

          {/* Contact and Summary Row */}
          <div className="flex flex-wrap items-center gap-6 mb-6 pb-6 border-b border-gray-200">
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <Mail className="w-4 h-4 text-gray-400" />
              <span>{staff.email}</span>
            </div>
            {staff.phone && (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Phone className="w-4 h-4 text-gray-400" />
                <span>{staff.phone}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <Award className="w-4 h-4 text-gray-400" />
              <span>{activeLicenses.length} License{activeLicenses.length !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* Active Licenses & Certifications Section */}
          <div>
            <h4 className="text-lg font-bold text-gray-900 mb-4">Active Licenses & Certifications</h4>
            <div className="space-y-3">
              {activeLicenses.length > 0 ? (
                activeLicenses.map((license) => {
                  const daysRemaining = license.days_until_expiry !== null && license.days_until_expiry !== undefined
                    ? license.days_until_expiry
                    : null

                  return (
                    <div
                      key={license.id}
                      className="bg-gray-50 rounded-lg p-4 flex items-start gap-4 hover:bg-gray-100 transition-colors"
                    >
                      {/* Ribbon Icon */}
                      <div className="flex-shrink-0 pt-1">
                        <Award className="w-5 h-5 text-gray-400" />
                      </div>

                      {/* License Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm font-medium text-gray-900">{license.license_type}</span>
                          <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                            Active
                          </span>
                        </div>
                        <div className="text-sm text-gray-600">
                          {license.license_number}
                          {license.state && ` • ${license.state}`}
                        </div>
                      </div>

                      {/* Expiry Info - Right Aligned */}
                      {license.expiry_date && (
                        <div className="flex-shrink-0 text-right">
                          <div className="text-xs text-gray-500 mb-1">Expires</div>
                          <div className="text-sm font-semibold text-gray-900">
                            {formatDate(license.expiry_date)}
                          </div>
                          {daysRemaining !== null && daysRemaining > 0 && daysRemaining <= 60 && (
                            <div className="text-sm text-orange-600 font-medium mt-1">
                              {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} remaining
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              ) : (
                <div className="text-center py-8 text-gray-500">
                  No active licenses or certifications
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
