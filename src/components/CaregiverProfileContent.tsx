'use client'

import { Key, MapPin } from 'lucide-react'
import { CAREGIVER_SKILL_POINTS } from '@/lib/constants'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import type { PatientDocument } from '@/lib/supabase/query/patients'
import { CaregiverDocumentsPanel } from './CaregiverDocumentsPanel'

interface StaffMember {
  id: string
  first_name: string
  last_name: string
  email: string
  phone?: string | null
  role: string
  status: string
  start_date?: string | null
  pay_rate?: string | number | null
  address?: string | null
  state?: string | null
  zip_code?: string | null
  skills?: string[] | null
  documents?: PatientDocument[] | null
}

interface StaffLicense {
  id: string
  staff_member_id: string
  license_type: string
  license_number: string
  state?: string | null
  status: string
  expiry_date?: string | null
  days_until_expiry?: number | null
}

export default function CaregiverProfileContent({
  staff,
  licenses,
  backHref,
  documentsPanelActive = true,
  onDocumentsBusyChange,
}: {
  staff: StaffMember
  licenses: StaffLicense[]
  backHref?: string
  /** When false, document panel does not sync (e.g. parent view hidden). */
  documentsPanelActive?: boolean
  /** e.g. block closing a modal while upload/delete is in progress. */
  onDocumentsBusyChange?: (busy: boolean) => void
}) {
  const formatDate = (date: string | Date | null) => {
    if (!date) return 'N/A'
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const activeLicenses = licenses.filter((l) => l.status === 'active')
  const stateZip = [staff.state, staff.zip_code].filter(Boolean).join(' ')
  const homeAddressLine = [staff.address, stateZip].filter(Boolean).join(', ')

  const skills = staff.skills ?? []

  const skillTypeToPillClass: Record<string, string> = {
    'Clinical Care': 'bg-red-100 text-red-700 border border-red-200',
    'Specialty Conditions': 'bg-purple-100 text-purple-700 border border-purple-200',
    'Physical Support': 'bg-amber-100 text-amber-700 border border-amber-200',
    'Daily Living': 'bg-green-100 text-green-700 border border-green-200',
    Certifications: 'bg-blue-100 text-blue-700 border border-blue-200',
    Language: 'bg-teal-100 text-teal-700 border border-teal-200',
  }

  return (
    <div className="space-y-6 relative">
      {backHref ? (
        <div className="absolute top-0 left-0">
          <Link
            href={`${backHref}?tab=schedule`}
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
        </div>
      ) : null}
      
      {/* Top fields grid */}
      <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${backHref ? 'pt-10' : ''}`}>
        <div>
          <div className="text-sm font-semibold text-gray-700 mb-2">Name</div>
          <div className="bg-gray-50 rounded-lg px-4 py-2 text-sm font-medium text-gray-900">{`${staff.first_name} ${staff.last_name}`}</div>
        </div>
        <div>
          <div className="text-sm font-semibold text-gray-700 mb-2">Role</div>
          <div className="bg-gray-50 rounded-lg px-4 py-2 text-sm font-medium text-gray-900">{staff.role}</div>
        </div>
        <div>
          <div className="text-sm font-semibold text-gray-700 mb-2">Email</div>
          <div className="bg-gray-50 rounded-lg px-4 py-2 text-sm font-medium text-gray-900">{staff.email}</div>
        </div>
        <div>
          <div className="text-sm font-semibold text-gray-700 mb-2">Phone</div>
          <div className="bg-gray-50 rounded-lg px-4 py-2 text-sm font-medium text-gray-900">{staff.phone ?? '-'}</div>
        </div>

        <div>
          <div className="text-sm font-semibold text-gray-700 mb-2">Hire Date</div>
          <div className="bg-gray-50 rounded-lg px-4 py-2 text-sm font-medium text-gray-900">
            {staff.start_date ? staff.start_date.split('T')[0] : 'N/A'}
          </div>
        </div>
        <div>
          <div className="text-sm font-semibold text-gray-700 mb-2">Status</div>
          <div className="bg-gray-50 rounded-lg px-4 py-2 text-sm font-medium text-gray-900">{staff.status}</div>
        </div>
      </div>

      {/* Pay Rate */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <span className="text-sm font-semibold text-gray-700">Pay Rate ($/hr)</span>
          </div>
          <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded-full font-semibold">Admin Only</span>
        </div>
        <div className="bg-gray-50 rounded-lg px-4 py-2 text-sm font-medium text-gray-900">
          {staff.pay_rate !== null && staff.pay_rate !== undefined && staff.pay_rate !== ''
            ? `$${typeof staff.pay_rate === 'number' ? staff.pay_rate.toFixed(2) : staff.pay_rate}`
            : '$--'}
        </div>
      </div>

      {/* Home Address */}
      <div>
        <div className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-green-600" />
          Home Address
        </div>
        <div className="bg-gray-50 rounded-lg px-4 py-2 text-sm font-medium text-gray-900">{homeAddressLine || '-'}</div>
      </div>

      {/* Certifications */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Certifications & Licenses</h4>
        {activeLicenses.length > 0 ? (
          <div className="space-y-3">
            {activeLicenses.map((license) => {
              const daysRemaining =
                license.days_until_expiry !== null && license.days_until_expiry !== undefined ? license.days_until_expiry : null
              return (
                <div key={license.id} className="bg-gray-50 rounded-xl px-4 py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex items-start gap-3">
                    <Key className="w-4 h-4 text-blue-600 mt-1 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900">{license.license_type}</span>
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold">Active</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1 truncate">
                        {license.license_number}
                        {license.state ? ` • ${license.state}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-gray-500 mb-1">Expires</div>
                    <div className="text-sm font-semibold text-gray-900">{license.expiry_date ? formatDate(license.expiry_date) : 'N/A'}</div>
                    {daysRemaining !== null && daysRemaining > 0 && daysRemaining <= 60 ? (
                      <div className="text-sm text-orange-600 font-medium mt-1">
                        {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} remaining
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-sm text-gray-500">No active licenses or certifications</div>
        )}
      </div>

      {/* Skills */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Skills</h4>
        <div className="flex flex-wrap gap-2">
          {skills.length > 0 ? (
            skills.map((s) => {
              const type = CAREGIVER_SKILL_POINTS.find((x) => x.name === s)?.type
              const pillClass = skillTypeToPillClass[type ?? ''] ?? 'bg-gray-100 text-gray-700 border border-gray-200'
              return (
                <span key={s} className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${pillClass}`}>
                  {s}
                </span>
              )
            })
          ) : (
            <span className="text-sm text-gray-400">No skills added yet.</span>
          )}
        </div>
      </div>

      <CaregiverDocumentsPanel
        active={documentsPanelActive}
        staffMemberId={staff.id}
        caregiverName={`${staff.first_name} ${staff.last_name}`.trim()}
        initialDocuments={staff.documents}
        readOnly
        onBusyChange={onDocumentsBusyChange}
      />
    </div>
  )
}

