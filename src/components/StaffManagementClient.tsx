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
  Clock as ClockIcon,
  Medal,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import * as q from '@/lib/supabase/query'
import AddStaffMemberModal from './AddStaffMemberModal'
import StaffActionsDropdown from './StaffActionsDropdown'
import ViewStaffDetailsModal from './ViewStaffDetailsModal'
import EditStaffModal from './EditStaffModal'
import ManageLicensesModal from './ManageLicensesModal'

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
  expiringLicensesCount?: number
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
  const [isViewDetailsOpen, setIsViewDetailsOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isManageLicensesOpen, setIsManageLicensesOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRole, setSelectedRole] = useState('all')
  const [selectedStatus, setSelectedStatus] = useState('all')


  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase()
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
        (staff.employee_id && staff.employee_id.toLowerCase().includes(query))
      
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

  const handleViewDetails = (staff: StaffMember) => {
    setSelectedStaff(staff)
    setIsViewDetailsOpen(true)
  }

  const handleEdit = (staff: StaffMember) => {
    setSelectedStaff(staff)
    setIsEditModalOpen(true)
  }

  const handleManageLicenses = (staff: StaffMember) => {
    setSelectedStaff(staff)
    setIsManageLicensesOpen(true)
  }

  const handleToggleStatus = async (staff: StaffMember, e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation() // Prevent row click from triggering

    const newStatus = e.target.checked ? 'active' : 'inactive'
    const action = newStatus === 'active' ? 'activate' : 'deactivate'

    if (!confirm(`Are you sure you want to ${action} ${staff.first_name} ${staff.last_name}?`)) {
      // Revert the toggle if user cancels
      e.target.checked = !e.target.checked
      return
    }

    try {
      const supabase = createClient()
      const { error } = await q.updateStaffMember(supabase, staff.id, { status: newStatus })

      if (error) {
        // Revert the toggle on error
        e.target.checked = !e.target.checked
        alert(`Failed to ${action} caregiver: ` + error.message)
        return
      }

      router.refresh()
    } catch (err: any) {
      // Revert the toggle on error
      e.target.checked = !e.target.checked
      alert(`Failed to ${action} caregiver: ` + err.message)
    }
  }

  return (
    <>
      <div className="space-y-6">
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
              className="px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white"
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
              className="px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="pending">Pending</option>
            </select>
          </div>
        </div>

        {/* Staff List Table */}
        {filteredStaffMembers.length > 0 ? (
          <div className="bg-white rounded-xl shadow-md border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Caregiver</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Role</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Email</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Phone</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Licenses</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Expiring Licenses</th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredStaffMembers.map((staff) => {
                    const licenses = licensesByStaff[staff.id] || []
                    const activeLicenses = licenses.filter(l => l.status === 'active')
                    const expiringCount = licenses.filter(l => {
                      if (l.days_until_expiry) {
                        return l.days_until_expiry <= 30 && l.days_until_expiry > 0
                      }
                      return false
                    }).length

                    return (
                      <tr 
                        key={staff.id} 
                        className="hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={() => handleViewDetails(staff)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                              {getInitials(staff.first_name, staff.last_name)}
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-gray-900">
                                {staff.first_name} {staff.last_name}
                              </div>
                              {staff.employee_id && (
                                <div className="text-xs text-gray-500">ID: {staff.employee_id}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{staff.role}</div>
                          {staff.job_title && (
                            <div className="text-xs text-gray-500">{staff.job_title}</div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={staff.status === 'active'}
                              onChange={(e) => handleToggleStatus(staff, e)}
                              onClick={(e) => e.stopPropagation()}
                              className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                            <span className="ml-3 text-sm font-medium text-gray-700">
                              {staff.status === 'active' ? 'Active' : 'Inactive'}
                            </span>
                          </label>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <Mail className="w-4 h-4 text-gray-400" />
                            {staff.email || <span className="text-gray-400">-</span>}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <Phone className="w-4 h-4 text-gray-400" />
                            {staff.phone || <span className="text-gray-400">-</span>}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <Medal className="w-4 h-4 text-gray-400" />
                            <span>{licenses.length} {licenses.length === 1 ? 'License' : 'Licenses'}</span>
                          </div>
                          {activeLicenses.length > 0 && (
                            <div className="text-xs text-gray-500 mt-1">{activeLicenses.length} active</div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {expiringCount > 0 ? (
                            <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-lg text-xs font-semibold flex items-center gap-1 w-fit">
                              <ClockIcon className="w-3 h-3" />
                              {expiringCount}
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium" onClick={(e) => e.stopPropagation()}>
                          <StaffActionsDropdown
                            staffId={staff.id}
                            onViewDetails={() => handleViewDetails(staff)}
                            onEdit={() => handleEdit(staff)}
                            onManageLicenses={() => handleManageLicenses(staff)}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
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
            isOpen={isViewDetailsOpen}
            onClose={() => {
              setIsViewDetailsOpen(false)
              setSelectedStaff(null)
            }}
            staff={selectedStaff}
            licenses={licensesByStaff[selectedStaff.id] || []}
          />

          <EditStaffModal
            isOpen={isEditModalOpen}
            onClose={() => {
              setIsEditModalOpen(false)
              setSelectedStaff(null)
            }}
            staff={selectedStaff}
            onSuccess={() => {
              setIsEditModalOpen(false)
              setSelectedStaff(null)
            }}
          />

          <ManageLicensesModal
            isOpen={isManageLicensesOpen}
            onClose={() => {
              setIsManageLicensesOpen(false)
              setSelectedStaff(null)
            }}
            staffId={selectedStaff.id}
            staffName={`${selectedStaff.first_name} ${selectedStaff.last_name}`}
            existingLicenses={licensesByStaff[selectedStaff.id] || []}
            onSuccess={() => {
              setIsManageLicensesOpen(false)
              setSelectedStaff(null)
            }}
          />
        </>
      )}
    </>
  )
}

