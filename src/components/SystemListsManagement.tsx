'use client'

import { useState, useMemo } from 'react'
import { Search, Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import {
  createCertificationType,
  updateCertificationType,
  deleteCertificationType,
  createStaffRole,
  updateStaffRole,
  deleteStaffRole
} from '@/app/actions/system-lists'

interface CertificationType {
  id: number
  certification_type: string
  created_at?: string
}

interface StaffRole {
  id: number
  name: string
  created_at?: string
}

interface SystemListsManagementProps {
  initialCertificationTypes: CertificationType[]
  initialStaffRoles: StaffRole[]
}

export default function SystemListsManagement({
  initialCertificationTypes,
  initialStaffRoles
}: SystemListsManagementProps) {
  const [certificationTypes, setCertificationTypes] = useState(initialCertificationTypes)
  const [staffRoles, setStaffRoles] = useState(initialStaffRoles)

  // Search states
  const [searchCertTypes, setSearchCertTypes] = useState('')
  const [searchRoles, setSearchRoles] = useState('')

  // Input states
  const [newCertType, setNewCertType] = useState('')
  const [newRole, setNewRole] = useState('')

  // Editing states
  const [editingCertType, setEditingCertType] = useState<{ id: number; value: string } | null>(null)
  const [editingRole, setEditingRole] = useState<{ id: number; value: string } | null>(null)

  // Loading states
  const [loadingCertType, setLoadingCertType] = useState(false)
  const [loadingRole, setLoadingRole] = useState(false)

  // Filtered lists
  const filteredCertTypes = useMemo(() => {
    if (!searchCertTypes) return certificationTypes
    const query = searchCertTypes.toLowerCase()
    return certificationTypes.filter(ct => 
      ct.certification_type.toLowerCase().includes(query)
    )
  }, [certificationTypes, searchCertTypes])

  const filteredRoles = useMemo(() => {
    if (!searchRoles) return staffRoles
    const query = searchRoles.toLowerCase()
    return staffRoles.filter(role => 
      role.name.toLowerCase().includes(query)
    )
  }, [staffRoles, searchRoles])

  // Certification Types Handlers
  const handleAddCertType = async () => {
    if (!newCertType.trim()) return
    setLoadingCertType(true)
    try {
      const result = await createCertificationType(newCertType.trim())
      if (result.error) {
        alert(`Error: ${result.error}`)
      } else {
        setCertificationTypes([...certificationTypes, result.data])
        setNewCertType('')
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setLoadingCertType(false)
    }
  }

  const handleEditCertType = (id: number, currentValue: string) => {
    setEditingCertType({ id, value: currentValue })
  }

  const handleSaveCertType = async () => {
    if (!editingCertType || !editingCertType.value.trim()) return
    setLoadingCertType(true)
    try {
      const result = await updateCertificationType(editingCertType.id, editingCertType.value.trim())
      if (result.error) {
        alert(`Error: ${result.error}`)
      } else {
        setCertificationTypes(certificationTypes.map(ct => 
          ct.id === editingCertType.id ? result.data : ct
        ))
        setEditingCertType(null)
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setLoadingCertType(false)
    }
  }

  const handleDeleteCertType = async (id: number) => {
    if (!confirm('Are you sure you want to delete this certification type?')) return
    setLoadingCertType(true)
    try {
      const result = await deleteCertificationType(id)
      if (result.error) {
        alert(`Error: ${result.error}`)
      } else {
        setCertificationTypes(certificationTypes.filter(ct => ct.id !== id))
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setLoadingCertType(false)
    }
  }

  // Staff Roles Handlers (UI only)
  const handleAddRole = async () => {
    
    if (!newRole.trim()) return
    setLoadingRole(true)

    try {
      const result = await createStaffRole(newRole.trim())
      if (result.error) {
        alert(`Error: ${result.error}`)
      } else {
        setStaffRoles([...staffRoles, result.data])
        setNewRole('')
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setLoadingRole(false)
    }
  }

  const handleEditRole = (id: number, currentValue: string) => {
    setEditingRole({ id, value: currentValue })
  }

  const handleSaveRole = async () => {
    if (!editingRole || !editingRole.value.trim()) return
    setLoadingRole(true)
    try {
      const result = await updateStaffRole(editingRole.id, editingRole.value.trim())
      if (result.error) {
        alert(`Error: ${result.error}`)
      } else {
        setStaffRoles(staffRoles.map(role => 
          role.id === editingRole.id ? result.data : role
        ))
        setEditingRole(null)
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setLoadingRole(false)
    }
  }

  const handleDeleteRole = async (id: number) => {
    if (!confirm('Are you sure you want to delete this staff role?')) return
    setLoadingRole(true)
    try {
      const result = await deleteStaffRole(id)
      if (result.error) {
        alert(`Error: ${result.error}`)
      } else {
        setStaffRoles(staffRoles.filter(role => role.id !== id))
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setLoadingRole(false)
    }
  }

  const renderListColumn = (
    title: string,
    items: any[],
    searchQuery: string,
    onSearchChange: (value: string) => void,
    newItem: string,
    onNewItemChange: (value: string) => void,
    onAdd: () => void,
    onEdit: (id: number, value: string) => void,
    onDelete: (id: number) => void,
    onSave: () => void,
    editingItem: { id: number; value: string } | null,
    setEditingItem: (item: { id: number; value: string } | null) => void,
    onCancel: () => void,
    isLoading: boolean,
    itemKey: string,
    itemValueKey: string
  ) => (
    <div className="flex flex-col h-full">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
      
      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
        <input
          type="text"
          placeholder={`Search ${title.toLowerCase()}...`}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Add New */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder={`Add new ${title.toLowerCase().slice(0, -1)}...`}
          value={newItem}
          onChange={(e) => onNewItemChange(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && onAdd()}
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          onClick={onAdd}
          disabled={isLoading || !newItem.trim()}
          className="flex items-center gap-1 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto space-y-2 max-h-[400px]">
        {items.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No items found</p>
        ) : (
          items.map((item) => {
            const isEditing = editingItem?.id === item[itemKey]
            const displayValue = item[itemValueKey]

            return (
              <div
                key={item[itemKey]}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                { isEditing && editingItem ? (
                  <>
                    <input
                      type="text"
                      value={editingItem.value}
                      onChange={(e) => setEditingItem({ ...editingItem, value: e.target.value })}
                      className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded bg-white focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                    <div className="flex items-center gap-2 ml-2">
                      <button
                        onClick={onSave}
                        disabled={isLoading}
                        className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={onCancel}
                        disabled={isLoading}
                        className="p-1 text-gray-600 hover:bg-gray-100 rounded transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-sm text-gray-900 flex-1">{displayValue}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onEdit(item[itemKey], displayValue)}
                        className="p-1 text-gray-600 hover:bg-gray-200 rounded transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onDelete(item[itemKey])}
                        className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )

  return (
    <div className="bg-white rounded-xl p-6 shadow-md border border-gray-100">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">System Lists Management</h2>
        <p className="text-sm text-gray-600">Manage certification types, issuing authorities, and staff roles.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Certification Types */}
        {renderListColumn(
          'Certification Types',
          filteredCertTypes,
          searchCertTypes,
          setSearchCertTypes,
          newCertType,
          setNewCertType,
          handleAddCertType,
          handleEditCertType,
          handleDeleteCertType,
          handleSaveCertType,
          editingCertType,
          setEditingCertType,
          () => setEditingCertType(null),
          loadingCertType,
          'id',
          'certification_type'
        )}



        {/* Staff Roles */}
        {renderListColumn(
          'Staff Roles',
          filteredRoles,
          searchRoles,
          setSearchRoles,
          newRole,
          setNewRole,
          handleAddRole,
          handleEditRole,
          handleDeleteRole,
          handleSaveRole,
          editingRole,
          setEditingRole,
          () => setEditingRole(null),
          loadingRole,
          'id',
          'name'
        )}
      </div>
    </div>
  )
}
