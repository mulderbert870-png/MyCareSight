'use client'

import { useMemo, useState } from 'react'
import { Check, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import {
  createCertificationType,
  createStaffRole,
  createTaskCatalogItem,
  deleteCertificationType,
  deleteStaffRole,
  deleteTaskCatalogItem,
  updateCertificationType,
  updateStaffRole,
  updateTaskCatalogItem,
} from '@/app/actions/system-lists'

interface CertificationType {
  id: number
  certification_type: string
}

interface StaffRole {
  id: number
  name: string
}

interface TaskCategoryItem {
  id: string
  name: string
}

interface TaskCatalogItem {
  id: string
  name: string
  categoryId: string
  categoryName: string
}

interface SystemListsManagementProps {
  initialCertificationTypes: CertificationType[]
  initialStaffRoles: StaffRole[]
  initialSkilledTasks: TaskCatalogItem[]
  initialNonSkilledTasks: TaskCatalogItem[]
  initialSkilledTaskCategories: TaskCategoryItem[]
  initialNonSkilledTaskCategories: TaskCategoryItem[]
}

type EditItem = { id: string | number; value: string } | null

export default function SystemListsManagement({
  initialCertificationTypes,
  initialStaffRoles,
  initialSkilledTasks,
  initialNonSkilledTasks,
  initialSkilledTaskCategories,
  initialNonSkilledTaskCategories,
}: SystemListsManagementProps) {
  const [certificationTypes, setCertificationTypes] = useState(initialCertificationTypes)
  const [staffRoles, setStaffRoles] = useState(initialStaffRoles)
  const [skilledTasks, setSkilledTasks] = useState(initialSkilledTasks)
  const [nonSkilledTasks, setNonSkilledTasks] = useState(initialNonSkilledTasks)

  const [searchCertTypes, setSearchCertTypes] = useState('')
  const [searchRoles, setSearchRoles] = useState('')
  const [searchSkilledTasks, setSearchSkilledTasks] = useState('')
  const [searchNonSkilledTasks, setSearchNonSkilledTasks] = useState('')

  const [newCertType, setNewCertType] = useState('')
  const [newRole, setNewRole] = useState('')
  const [newSkilledTask, setNewSkilledTask] = useState('')
  const [newNonSkilledTask, setNewNonSkilledTask] = useState('')
  const [selectedSkilledCategoryId, setSelectedSkilledCategoryId] = useState(
    initialSkilledTaskCategories[0]?.id ?? ''
  )
  const [selectedNonSkilledCategoryId, setSelectedNonSkilledCategoryId] = useState(
    initialNonSkilledTaskCategories[0]?.id ?? ''
  )

  const [editingCertType, setEditingCertType] = useState<EditItem>(null)
  const [editingRole, setEditingRole] = useState<EditItem>(null)
  const [editingSkilledTask, setEditingSkilledTask] = useState<EditItem>(null)
  const [editingNonSkilledTask, setEditingNonSkilledTask] = useState<EditItem>(null)

  const [loadingCertType, setLoadingCertType] = useState(false)
  const [loadingRole, setLoadingRole] = useState(false)
  const [loadingSkilledTask, setLoadingSkilledTask] = useState(false)
  const [loadingNonSkilledTask, setLoadingNonSkilledTask] = useState(false)

  const filteredCertTypes = useMemo(() => {
    if (!searchCertTypes) return certificationTypes
    const query = searchCertTypes.toLowerCase()
    return certificationTypes.filter((ct) => ct.certification_type.toLowerCase().includes(query))
  }, [certificationTypes, searchCertTypes])

  const filteredRoles = useMemo(() => {
    if (!searchRoles) return staffRoles
    const query = searchRoles.toLowerCase()
    return staffRoles.filter((role) => role.name.toLowerCase().includes(query))
  }, [staffRoles, searchRoles])

  const filteredSkilledTasks = useMemo(() => {
    if (!searchSkilledTasks) return skilledTasks
    const query = searchSkilledTasks.toLowerCase()
    return skilledTasks.filter(
      (task) =>
        task.name.toLowerCase().includes(query) || task.categoryName.toLowerCase().includes(query)
    )
  }, [skilledTasks, searchSkilledTasks])

  const filteredNonSkilledTasks = useMemo(() => {
    if (!searchNonSkilledTasks) return nonSkilledTasks
    const query = searchNonSkilledTasks.toLowerCase()
    return nonSkilledTasks.filter(
      (task) =>
        task.name.toLowerCase().includes(query) || task.categoryName.toLowerCase().includes(query)
    )
  }, [nonSkilledTasks, searchNonSkilledTasks])

  const handleAddCertType = async () => {
    if (!newCertType.trim()) return
    setLoadingCertType(true)
    try {
      const result = await createCertificationType(newCertType.trim())
      if (result.error) alert(`Error: ${result.error}`)
      else {
        setCertificationTypes([...certificationTypes, result.data])
        setNewCertType('')
      }
    } finally {
      setLoadingCertType(false)
    }
  }

  const handleSaveCertType = async () => {
    if (!editingCertType || !editingCertType.value.trim()) return
    setLoadingCertType(true)
    try {
      const result = await updateCertificationType(Number(editingCertType.id), editingCertType.value.trim())
      if (result.error) alert(`Error: ${result.error}`)
      else {
        setCertificationTypes(certificationTypes.map((ct) => (ct.id === editingCertType.id ? result.data : ct)))
        setEditingCertType(null)
      }
    } finally {
      setLoadingCertType(false)
    }
  }

  const handleDeleteCertType = async (id: number) => {
    if (!confirm('Are you sure you want to delete this certification type?')) return
    setLoadingCertType(true)
    try {
      const result = await deleteCertificationType(id)
      if (result.error) alert(`Error: ${result.error}`)
      else setCertificationTypes(certificationTypes.filter((ct) => ct.id !== id))
    } finally {
      setLoadingCertType(false)
    }
  }

  const handleAddRole = async () => {
    if (!newRole.trim()) return
    setLoadingRole(true)
    try {
      const result = await createStaffRole(newRole.trim())
      if (result.error) alert(`Error: ${result.error}`)
      else {
        setStaffRoles([...staffRoles, result.data])
        setNewRole('')
      }
    } finally {
      setLoadingRole(false)
    }
  }

  const handleSaveRole = async () => {
    if (!editingRole || !editingRole.value.trim()) return
    setLoadingRole(true)
    try {
      const result = await updateStaffRole(Number(editingRole.id), editingRole.value.trim())
      if (result.error) alert(`Error: ${result.error}`)
      else {
        setStaffRoles(staffRoles.map((role) => (role.id === editingRole.id ? result.data : role)))
        setEditingRole(null)
      }
    } finally {
      setLoadingRole(false)
    }
  }

  const handleDeleteRole = async (id: number) => {
    if (!confirm('Are you sure you want to delete this staff role?')) return
    setLoadingRole(true)
    try {
      const result = await deleteStaffRole(id)
      if (result.error) alert(`Error: ${result.error}`)
      else setStaffRoles(staffRoles.filter((role) => role.id !== id))
    } finally {
      setLoadingRole(false)
    }
  }

  const handleAddTask = async (serviceType: 'skilled' | 'non_skilled') => {
    const taskName = serviceType === 'skilled' ? newSkilledTask : newNonSkilledTask
    const selectedCategoryId =
      serviceType === 'skilled' ? selectedSkilledCategoryId : selectedNonSkilledCategoryId
    if (!taskName.trim()) return

    if (serviceType === 'skilled') setLoadingSkilledTask(true)
    else setLoadingNonSkilledTask(true)

    try {
      const result = await createTaskCatalogItem(serviceType, taskName.trim(), selectedCategoryId || null)
      if (result.error) {
        alert(`Error: ${result.error}`)
      } else if (!result.data) {
        alert('Error: task was saved but no data was returned.')
      } else if (serviceType === 'skilled') {
        setSkilledTasks([...skilledTasks, result.data])
        setNewSkilledTask('')
      } else {
        setNonSkilledTasks([...nonSkilledTasks, result.data])
        setNewNonSkilledTask('')
      }
    } finally {
      if (serviceType === 'skilled') setLoadingSkilledTask(false)
      else setLoadingNonSkilledTask(false)
    }
  }

  const handleSaveTask = async (serviceType: 'skilled' | 'non_skilled') => {
    const editing = serviceType === 'skilled' ? editingSkilledTask : editingNonSkilledTask
    if (!editing || !editing.value.trim()) return
    if (serviceType === 'skilled') setLoadingSkilledTask(true)
    else setLoadingNonSkilledTask(true)
    try {
      const result = await updateTaskCatalogItem(String(editing.id), editing.value.trim())
      if (result.error) alert(`Error: ${result.error}`)
      else if (!result.data) alert('Error: task was updated but no data was returned.')
      else if (serviceType === 'skilled') {
        setSkilledTasks(skilledTasks.map((t) => (t.id === editing.id ? result.data : t)))
        setEditingSkilledTask(null)
      } else {
        setNonSkilledTasks(nonSkilledTasks.map((t) => (t.id === editing.id ? result.data : t)))
        setEditingNonSkilledTask(null)
      }
    } finally {
      if (serviceType === 'skilled') setLoadingSkilledTask(false)
      else setLoadingNonSkilledTask(false)
    }
  }

  const handleDeleteTask = async (serviceType: 'skilled' | 'non_skilled', id: string) => {
    if (!confirm('Are you sure you want to delete this task?')) return
    if (serviceType === 'skilled') setLoadingSkilledTask(true)
    else setLoadingNonSkilledTask(true)
    try {
      const result = await deleteTaskCatalogItem(id)
      if (result.error) alert(`Error: ${result.error}`)
      else if (serviceType === 'skilled') setSkilledTasks(skilledTasks.filter((t) => t.id !== id))
      else setNonSkilledTasks(nonSkilledTasks.filter((t) => t.id !== id))
    } finally {
      if (serviceType === 'skilled') setLoadingSkilledTask(false)
      else setLoadingNonSkilledTask(false)
    }
  }

  const renderSimpleListColumn = (
    title: string,
    items: Array<{ id: number; value: string }>,
    searchQuery: string,
    onSearchChange: (value: string) => void,
    newValue: string,
    onNewValueChange: (value: string) => void,
    onAdd: () => void,
    onSave: () => void,
    onDelete: (id: number) => void,
    editing: EditItem,
    setEditing: (item: EditItem) => void,
    loading: boolean
  ) => (
    <div className="flex flex-col h-full">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
        <input
          type="text"
          placeholder={`Search ${title.toLowerCase()}...`}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg"
        />
      </div>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder={`Add new ${title.toLowerCase().slice(0, -1)}...`}
          value={newValue}
          onChange={(e) => onNewValueChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAdd()}
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg"
        />
        <button
          onClick={onAdd}
          disabled={loading || !newValue.trim()}
          className="flex items-center gap-1 px-4 py-2 bg-gray-900 text-white rounded-lg disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2 max-h-[400px]">
        {items.map((item) => {
          const isEditing = editing?.id === item.id
          return (
            <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              {isEditing ? (
                <>
                  <input
                    type="text"
                    value={editing?.value ?? ''}
                    onChange={(e) => setEditing({ id: item.id, value: e.target.value })}
                    className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded bg-white"
                  />
                  <div className="flex items-center gap-2 ml-2">
                    <button onClick={onSave} disabled={loading} className="p-1 text-green-600">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditing(null)} disabled={loading} className="p-1 text-gray-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="text-sm text-gray-900">{item.value}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditing({ id: item.id, value: item.value })} className="p-1 text-gray-600">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => onDelete(item.id)} className="p-1 text-red-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
        {items.length === 0 ? <p className="text-sm text-gray-500 text-center py-4">No items found</p> : null}
      </div>
    </div>
  )

  const renderTaskColumn = (
    title: string,
    tasks: TaskCatalogItem[],
    searchQuery: string,
    onSearchChange: (value: string) => void,
    newTask: string,
    onNewTaskChange: (value: string) => void,
    selectedCategoryId: string,
    onSelectedCategoryChange: (value: string) => void,
    categories: TaskCategoryItem[],
    editingTask: EditItem,
    setEditingTask: (item: EditItem) => void,
    onAddTask: () => void,
    onSaveTask: () => void,
    onDeleteTask: (id: string) => void,
    loading: boolean
  ) => (
    <div className="flex flex-col h-full">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
        <input
          type="text"
          placeholder={`Search ${title.toLowerCase()}...`}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg"
        />
      </div>

      <div className="flex gap-2 mb-4">
        <select
          value={selectedCategoryId}
          onChange={(e) => onSelectedCategoryChange(e.target.value)}
          className="w-36 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
        >
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Add new task..."
          value={newTask}
          onChange={(e) => onNewTaskChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAddTask()}
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg"
        />
        <button
          onClick={onAddTask}
          disabled={loading || !newTask.trim() || !selectedCategoryId}
          className="flex items-center gap-1 px-4 py-2 bg-gray-900 text-white rounded-lg disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 max-h-[400px]">
        {tasks.map((task) => {
          const isEditing = editingTask?.id === task.id
          return (
            <div key={task.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              {isEditing ? (
                <>
                  <input
                    type="text"
                    value={editingTask?.value ?? ''}
                    onChange={(e) => setEditingTask({ id: task.id, value: e.target.value })}
                    className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded bg-white"
                  />
                  <div className="flex items-center gap-2 ml-2">
                    <button onClick={onSaveTask} disabled={loading} className="p-1 text-green-600">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditingTask(null)} disabled={loading} className="p-1 text-gray-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-gray-900 truncate">{task.name}</span>
                    <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                      {task.categoryName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditingTask({ id: task.id, value: task.name })} className="p-1 text-gray-600">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => onDeleteTask(task.id)} className="p-1 text-red-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
        {tasks.length === 0 ? <p className="text-sm text-gray-500 text-center py-4">No tasks found</p> : null}
      </div>
    </div>
  )

  return (
    <div className="bg-white rounded-xl p-6 shadow-md border border-gray-100">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">System Lists Management</h2>
        <p className="text-sm text-gray-600">Manage certification types, staff roles, and task catalogs.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {renderSimpleListColumn(
          'Certification Types',
          filteredCertTypes.map((item) => ({ id: item.id, value: item.certification_type })),
          searchCertTypes,
          setSearchCertTypes,
          newCertType,
          setNewCertType,
          handleAddCertType,
          handleSaveCertType,
          handleDeleteCertType,
          editingCertType,
          setEditingCertType,
          loadingCertType
        )}

        {renderSimpleListColumn(
          'Staff Roles',
          filteredRoles.map((item) => ({ id: item.id, value: item.name })),
          searchRoles,
          setSearchRoles,
          newRole,
          setNewRole,
          handleAddRole,
          handleSaveRole,
          handleDeleteRole,
          editingRole,
          setEditingRole,
          loadingRole
        )}

        {renderTaskColumn(
          'Skilled Tasks',
          filteredSkilledTasks,
          searchSkilledTasks,
          setSearchSkilledTasks,
          newSkilledTask,
          setNewSkilledTask,
          selectedSkilledCategoryId,
          setSelectedSkilledCategoryId,
          initialSkilledTaskCategories,
          editingSkilledTask,
          setEditingSkilledTask,
          () => handleAddTask('skilled'),
          () => handleSaveTask('skilled'),
          (id) => handleDeleteTask('skilled', id),
          loadingSkilledTask
        )}

        {renderTaskColumn(
          'Non-Skilled Tasks',
          filteredNonSkilledTasks,
          searchNonSkilledTasks,
          setSearchNonSkilledTasks,
          newNonSkilledTask,
          setNewNonSkilledTask,
          selectedNonSkilledCategoryId,
          setSelectedNonSkilledCategoryId,
          initialNonSkilledTaskCategories,
          editingNonSkilledTask,
          setEditingNonSkilledTask,
          () => handleAddTask('non_skilled'),
          () => handleSaveTask('non_skilled'),
          (id) => handleDeleteTask('non_skilled', id),
          loadingNonSkilledTask
        )}
      </div>
    </div>
  )
}
