'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { 
  Users, 
  CheckCircle2, 
  Clock, 
  Search,
  Plus,
  Mail,
  Phone,
  Medal,
  MapPin,
} from 'lucide-react'
import { CAREGIVER_SKILL_POINTS } from '@/lib/constants'
import AddStaffMemberModal from './AddStaffMemberModal'
import StaffActionsDropdown from './StaffActionsDropdown'
import ViewStaffDetailsModal from './ViewStaffDetailsModal'
import EditCaregiverSkillsModal from './EditCaregiverSkillsModal'
import EditCaregiverHomeAddressModal from './EditCaregiverHomeAddressModal'
import ManageCaregiverDocumentsModal from './ManageCaregiverDocumentsModal'
import type { PatientDocument } from '@/lib/supabase/query/patients'

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
  address?: string | null
  state?: string | null
  zip_code?: string | null
  skills?: string[] | null
  created_at?: string
  expiringLicensesCount?: number
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

interface StaffManagementClientProps {
  staffMembers: StaffMember[]
  licensesByStaff: Record<string, StaffLicense[]>
  totalStaff: number
  activeStaff: number
  expiringLicenses: number
  staffWithExpiringLicenses: (StaffMember & { expiringLicensesCount?: number })[]
  staffRoleNames: string[]
}

export default function StaffManagementClient({
  staffMembers,
  licensesByStaff,
  totalStaff,
  activeStaff,
  expiringLicenses,
  staffWithExpiringLicenses, 
  staffRoleNames,
}: StaffManagementClientProps) {
  const router = useRouter()
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null)
  const [isViewProfileOpen, setIsViewProfileOpen] = useState(false)
  const [isEditSkillsOpen, setIsEditSkillsOpen] = useState(false)
  const [isEditHomeAddressOpen, setIsEditHomeAddressOpen] = useState(false)
  const [isManageDocumentsOpen, setIsManageDocumentsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRole, setSelectedRole] = useState('all')
  const [selectedStatus, setSelectedStatus] = useState('all')

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase()
  }

  const formatDate = (date: string | Date | null | undefined) => {
    if (!date) return 'N/A'
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const skillTypeToPillClass: Record<string, string> = {
    'Clinical Care': 'bg-orange-500 text-white',
    'Specialty Conditions': 'bg-purple-500 text-white',
    'Physical Support': 'bg-amber-600 text-white',
    'Daily Living': 'bg-green-600 text-white',
    Certifications: 'bg-blue-600 text-white',
    Language: 'bg-teal-600 text-white',
  }

  // Filter staff members based on search query and filters
  const filteredStaffMembers = staffWithExpiringLicenses.filter((staff) => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      const matchesSearch = 
        staff.first_name.toLowerCase().includes(query) ||
        staff.last_name.toLowerCase().includes(query) ||
        staff.email.toLowerCase().includes(query) ||
        staff.role.toLowerCase().includes(query) ||
        (staff.job_title && staff.job_title.toLowerCase().includes(query)) ||
        (staff.employee_id && staff.employee_id.toLowerCase().includes(query)) ||
        (staff.address && staff.address.toLowerCase().includes(query))
      
      if (!matchesSearch) return false
    }

    // Role filter
    if (selectedRole !== 'all' && staff.role !== selectedRole) {
      return false
    }

    // Status filter
    if (selectedStatus !== 'all' && staff.status !== selectedStatus) {
      return false
    }

    return true
  })

  const handleViewProfile = (staff: StaffMember) => {
    setSelectedStaff(staff)
    setIsViewProfileOpen(true)
  }

  const handleEditSkills = (staff: StaffMember) => {
    setSelectedStaff(staff)
    setIsEditSkillsOpen(true)
  }

  const handleEditHomeAddress = (staff: StaffMember) => {
    setSelectedStaff(staff)
    setIsEditHomeAddressOpen(true)
  }

  const handleManageDocuments = (staff: StaffMember) => {
    console.log("staff: ",staff)
    setSelectedStaff(staff)
    setIsManageDocumentsOpen(true)
  }

  return (
    <>
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
              <Users className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Caregiver Management</h1>
              <p className="text-gray-600 text-sm">
                Manage your team members and track their professional licenses
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-6 py-3 bg-black text-white font-semibold rounded-xl hover:bg-gray-800 transition-all flex items-center gap-2 shadow-lg"
          >
            <Plus className="w-5 h-5" />
            Add Caregiver
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl p-6 shadow-md border border-gray-100">
            <div className="flex items-center gap-3 mb-2">
              <Users className="w-6 h-6 text-blue-600" />
              <span className="text-sm font-semibold text-gray-600">Total Caregivers</span>
            </div>
            <div className="text-xl font-bold text-gray-900">{totalStaff}</div>
          </div>

          <div className="bg-white rounded-xl p-6 shadow-md border border-gray-100">
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle2 className="w-6 h-6 text-green-600" />
              <span className="text-sm font-semibold text-gray-600">Active Caregivers</span>
            </div>
            <div className="text-xl font-bold text-gray-900">{activeStaff}</div>
          </div>

          <div className="bg-white rounded-xl p-6 shadow-md border border-gray-100">
            <div className="flex items-center gap-3 mb-2">
              <Clock className="w-6 h-6 text-yellow-600" />
              <span className="text-sm font-semibold text-gray-600">Licenses Expiring Soon</span>
            </div>
            <div className="text-xl font-bold text-gray-900">{expiringLicenses}</div>
          </div>
        </div>

        {/* Search and Filter */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search staff by name, email, or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white"
              suppressHydrationWarning
            />
          </div>
          <div className="flex gap-2">
            <select 
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="px-4 py-3 border border-gray-300 cursor-pointer rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white"
            >
              <option value="all">All Roles</option>
              {
                staffRoleNames.map((roleName) => (
                  <option key={roleName} value={roleName}>{roleName}</option>
                ))
              }
            </select>
            <select 
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-4 py-3 border border-gray-300 rounded-xl cursor-pointer focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="pending">Pending</option>
            </select>
          </div>
        </div>

        {/* Caregiver Cards */}
        {filteredStaffMembers.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 w-full">
            {filteredStaffMembers.map((staff) => {
              const licenses = licensesByStaff[staff.id] || []
              const activeLicenses = licenses.filter((l) => l.status === 'active')

              const stateZip = [staff.state, staff.zip_code].filter(Boolean).join(' ')
              const homeAddressLine = [staff.address, stateZip].filter(Boolean).join(', ')

              const skills = staff.skills ?? []
              const activeLicenseCount = activeLicenses.length

              return (
                <div
                  key={staff.id}
                  className="bg-white rounded-xl shadow-md border border-gray-100 p-6 hover:bg-gray-50 transition-colors"
                  // onClick={() => handleViewProfile(staff)}
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                      {getInitials(staff.first_name, staff.last_name)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-sm font-semibold text-gray-900">
                              {staff.first_name} {staff.last_name}
                            </div>
                            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                              {staff.status === 'active' ? 'Active' : staff.status}
                            </span>
                          </div>
                          <div className="mt-4 text-sm text-gray-600 grid grid-cols-4 flex-wrap items-center gap-x-10 gap-y-1">
                            <div className="inline-flex items-center gap-2">
                              <Mail className="w-4 h-4 text-gray-400" />
                              <span className="truncate">{staff.email || '-'}</span>
                            </div>
                            <div className="inline-flex items-center gap-2">
                              <Phone className="w-4 h-4 text-gray-400" />
                              <span className="truncate">{staff.phone || '-'}</span>
                            </div>
                            <div className="text-sm text-gray-600 inline-flex items-center gap-2">
                              <div className="inline-flex items-center gap-2">
                                <Medal className="w-4 h-4 text-gray-400" />
                                <span>
                                  {licenses.length}{' '}
                                  {licenses.length === 1 ? 'Certification' : 'Certifications'}
                                </span>
                              </div>
                            </div>
                            <div className="text-sm text-gray-700 inline-flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-green-600" />
                              <span className="truncate">{homeAddressLine || '-'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-start gap-3">
                            <div className="relative" onClick={(e) => e.stopPropagation()}>
                              <StaffActionsDropdown
                                staffId={staff.id}
                                onViewProfile={() => handleViewProfile(staff)}
                                onEditSkills={() => handleEditSkills(staff)}
                                onEditHomeAddress={() => handleEditHomeAddress(staff)}
                              />
                            </div>
                        </div>
                      </div>

                      
                    </div>
                  </div>

                  {/* Skills */}
                  <div className="mt-4">
                    <div className="flex items-center">
                      <div className="text-lg font-semibold text-gray-700 mr-6">Skills</div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleEditSkills(staff)
                        }}
                        className="text-sm text-blue-600 hover:bg-gray-300 rounded-md font-medium py1 px-2"
                      >
                        Edit
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2 mt-2">
                      {skills.length > 0 ? (
                        skills.map((s) => {
                          const type = CAREGIVER_SKILL_POINTS.find((x) => x.name === s)?.type
                          const pillClass = skillTypeToPillClass[type ?? ''] ?? 'bg-gray-500 text-white'
                          return (
                            <span key={s} className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${pillClass}`}>
                              {s}
                            </span>
                          )
                        })
                      ) : (
                        <span className="text-sm text-gray-400">No skills added yet.</span>
                      )}
                    </div>
                  </div>

                  {/* Licenses */}
                  <div className="mt-5">
                    <div className="text-sm font-semibold text-gray-700 mb-3">Active Certifications & Licenses</div>

                    {activeLicenseCount > 0 ? (
                      <div className="space-y-3">
                        {activeLicenses.map((license) => (
                          <div
                            key={license.id}
                            className="bg-gray-50 rounded-lg px-4 py-3 flex items-start justify-between gap-4"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Medal className="w-4 h-4 text-gray-400" />
                                <span className="text-sm font-semibold text-gray-900">{license.license_type}</span>
                                <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                                  Active
                                </span>
                              </div>
                              <div className="text-xs text-gray-500 mt-1 truncate">
                                {license.license_number}
                                {license.state ? ` • ${license.state}` : ''}
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <div className="text-xs text-gray-500">Expires</div>
                              <div className="text-sm font-semibold text-gray-900">
                                {license.expiry_date ? formatDate(license.expiry_date) : 'N/A'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500">No active certifications/licenses yet.</div>
                    )}
                  </div>

                  {/* Documents */}
                  <div className="mt-5">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-700">Documents</div>
                      <button
                        type="button"
                        className="px-4 py-2 border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-50 transition-colors text-sm font-medium"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleManageDocuments(staff)
                        }}
                      >
                        Manage Documents
                      </button>
                    </div>
                    <p className="text-sm text-gray-500 mt-2">
                      {Array.isArray(staff.documents) && staff.documents.length > 0
                        ? `${staff.documents.length} document${staff.documents.length === 1 ? '' : 's'} on file.`
                        : 'No documents uploaded yet.'}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}

        {/* Empty State */}
        {staffMembers.length === 0 ? (
          <div className="bg-white rounded-xl shadow-md border border-gray-100 p-12 text-center">
            <Users className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No caregivers yet</h3>
            <p className="text-gray-600 mb-6">Get started by adding your first caregiver</p>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="inline-flex items-center gap-2 px-6 py-3 bg-black text-white font-semibold rounded-xl hover:bg-gray-800 transition-all"
            >
              <Plus className="w-5 h-5" />
              Add Caregiver
            </button>
          </div>
        ) : filteredStaffMembers.length === 0 ? (
          <div className="bg-white rounded-xl shadow-md border border-gray-100 p-12 text-center">
            <Search className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No careigvers found</h3>
            <p className="text-gray-600 mb-6">Try adjusting your search or filter criteria</p>
            <button
              onClick={() => {
                setSearchQuery('')
                setSelectedRole('all')
                setSelectedStatus('all')
              }}
              className="inline-flex items-center gap-2 px-6 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition-all"
            >
              Clear Filters
            </button>
          </div>
        ) : null}
      </div>

      {/* Modals */}
      <AddStaffMemberModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={() => {
          setIsAddModalOpen(false)
        }}
        staffRoleNames={staffRoleNames}
      />

      {selectedStaff && (
        <>
          <ViewStaffDetailsModal
            isOpen={isViewProfileOpen}
            onClose={() => {
              setIsViewProfileOpen(false)
              setSelectedStaff(null)
            }}
            staff={selectedStaff}
            licenses={licensesByStaff[selectedStaff.id] || []}
          />

          <EditCaregiverSkillsModal
            isOpen={isEditSkillsOpen}
            onClose={() => {
              setIsEditSkillsOpen(false)
            }}
            caregiver={selectedStaff}
            onSuccess={() => {
              setIsEditSkillsOpen(false)
              setSelectedStaff(null)
              router.refresh()
            }}
          />

          <EditCaregiverHomeAddressModal
            isOpen={isEditHomeAddressOpen}
            onClose={() => {
              setIsEditHomeAddressOpen(false)
            }}
            caregiver={selectedStaff}
            onSuccess={() => {
              setIsEditHomeAddressOpen(false)
              setSelectedStaff(null)
              router.refresh()
            }}
          />

          <ManageCaregiverDocumentsModal
            isOpen={isManageDocumentsOpen}
            onClose={() => {
              setIsManageDocumentsOpen(false)
              setSelectedStaff(null)
            }}
            staffMemberId={selectedStaff.id}
            caregiverName={`${selectedStaff.first_name} ${selectedStaff.last_name}`.trim()}
            initialDocuments={
              staffWithExpiringLicenses.find((s) => s.id === selectedStaff.id)?.documents ??
              selectedStaff.documents
            }
          />
        </>
      )}
    </>
  )
}

