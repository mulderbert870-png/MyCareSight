'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import * as q from '@/lib/supabase/query'
import { fetchFilteredExpertsAction } from '@/app/actions/admin-list-filters'
import {
  Search,
  Mail,
  Phone,
  MapPin,
  Briefcase,
  MoreVertical,
  User,
  Edit,
  Users,
  BarChart3,
  UserX,
} from 'lucide-react'

interface Expert {
  id: string
  user_id: string
  first_name: string
  last_name: string
  email: string
  phone?: string
  status: string
  role: string
  expertise?: string
}

interface ExpertListWithFiltersProps {
  experts: Expert[]
  statesByExpert: Record<string, string[]>
  clientsByExpert: Record<string, number>
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

export default function ExpertListWithFilters({
  experts,
  statesByExpert,
  clientsByExpert,
}: ExpertListWithFiltersProps) {
  const router = useRouter()
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput, 300)
  const [selectedState, setSelectedState] = useState('All States')
  const [selectedStatus, setSelectedStatus] = useState('All Status')
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null)
  const dropdownRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const hasServerFilter = useMemo(
    () =>
      debouncedSearch.trim() !== '' ||
      selectedState !== 'All States' ||
      selectedStatus !== 'All Status',
    [debouncedSearch, selectedState, selectedStatus]
  )

  const [serverPayload, setServerPayload] = useState<Awaited<
    ReturnType<typeof fetchFilteredExpertsAction>
  >['data']>(null)
  const [filterLoading, setFilterLoading] = useState(false)

  useEffect(() => {
    if (!hasServerFilter) {
      setServerPayload(null)
      setFilterLoading(false)
      return
    }
    let cancelled = false
    setFilterLoading(true)
    fetchFilteredExpertsAction({
      search: debouncedSearch,
      selectedState,
      selectedStatus,
    }).then((res) => {
      if (cancelled) return
      if (res.error) {
        setServerPayload(null)
      } else {
        setServerPayload(res.data)
      }
      setFilterLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [hasServerFilter, debouncedSearch, selectedState, selectedStatus])

  const displayExperts = hasServerFilter ? ((serverPayload?.experts ?? []) as unknown as Expert[]) : experts
  const displayStatesByExpert = hasServerFilter ? serverPayload?.statesByExpert ?? {} : statesByExpert
  const displayClientsByExpert = hasServerFilter ? serverPayload?.clientsByExpert ?? {} : clientsByExpert

  const allStates = useMemo(() => {
    const statesSet = new Set<string>()
    Object.values(statesByExpert).forEach((states) => {
      states.forEach((state) => statesSet.add(state))
    })
    return Array.from(statesSet).sort()
  }, [statesByExpert])

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase()
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        openDropdownId &&
        dropdownRefs.current[openDropdownId] &&
        !dropdownRefs.current[openDropdownId]?.contains(event.target as Node)
      ) {
        setOpenDropdownId(null)
      }
    }

    if (openDropdownId) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [openDropdownId])

  const handleToggleDropdown = (expertId: string) => {
    setOpenDropdownId(openDropdownId === expertId ? null : expertId)
  }

  const handleViewProfile = (expert: Expert) => {
    setOpenDropdownId(null)
    router.push(`/pages/admin/experts/${expert.id}`)
  }

  const handleEditInformation = (expert: Expert) => {
    setOpenDropdownId(null)
    router.push(`/pages/admin/experts/${expert.id}/edit`)
  }

  const handleManageClients = (expert: Expert) => {
    setOpenDropdownId(null)
    router.push(`/pages/admin/experts/${expert.id}/clients`)
  }

  const handleViewPerformance = (expert: Expert) => {
    setOpenDropdownId(null)
    router.push(`/pages/admin/experts/${expert.id}/performance`)
  }

  const handleToggleStatus = async (expert: Expert) => {
    const isActive = expert.status === 'active'
    const actionText = isActive ? 'deactivate' : 'activate'

    if (!confirm(`Are you sure you want to ${actionText} ${expert.first_name} ${expert.last_name}?`)) {
      return
    }

    setOpenDropdownId(null)

    try {
      const supabase = createClient()
      const newStatus = isActive ? 'inactive' : 'active'

      const { error } = await q.updateLicensingExpertById(supabase, expert.id, {
        status: newStatus,
        updated_at: new Date().toISOString(),
      })

      if (error) {
        alert(`Failed to ${actionText} expert: ${error.message}`)
        return
      }

      router.refresh()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      alert(`Failed to ${actionText} expert: ${message}`)
    }
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="bg-white rounded-xl p-4 shadow-md border border-gray-100">
        <div className="flex flex-col gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 md:w-5 md:h-5" />
            <input
              type="text"
              placeholder="Search experts by name, email, or expertise..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-9 md:pl-10 pr-4 py-2 text-sm md:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="flex flex-wrap gap-2 md:gap-3">
            <select
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value)}
              className="flex-1 min-w-[120px] px-3 md:px-4 py-2 text-sm md:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="All States">All States</option>
              {allStates.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="flex-1 min-w-[120px] px-3 md:px-4 py-2 text-sm md:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="All Status">All Status</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {hasServerFilter && filterLoading ? (
          <div className="bg-white rounded-xl p-6 text-center text-gray-500 text-sm border border-gray-100 shadow-md">
            Searching…
          </div>
        ) : displayExperts && displayExperts.length > 0 ? (
          displayExperts.map((expert) => {
            const expertStatesList = displayStatesByExpert[expert.id] || []
            const clientCount = displayClientsByExpert[expert.id] || 0

            return (
              <div key={expert.id} className="bg-white rounded-xl p-4 md:p-6 shadow-md border border-gray-100">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 md:gap-4 flex-1 min-w-0">
                    <div className="w-12 h-12 md:w-16 md:h-16 bg-blue-500 rounded-full flex items-center justify-center text-white font-semibold text-sm md:text-lg flex-shrink-0">
                      {getInitials(expert.first_name, expert.last_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-2">
                        <h3 className="text-lg md:text-xl font-bold text-gray-900 break-words">
                          {expert.first_name} {expert.last_name}
                        </h3>
                        <span
                          className={`px-2 md:px-3 py-1 text-xs font-semibold rounded-full whitespace-nowrap ${
                            expert.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {expert.status}
                        </span>
                      </div>
                      <div className="text-sm md:text-base text-gray-600 mb-3">{expert.role}</div>
                      <div className="space-y-1 text-xs md:text-sm text-gray-600 mb-3">
                        <div className="flex items-center gap-2">
                          <Mail className="w-3 h-3 md:w-4 md:h-4 flex-shrink-0" />
                          <span className="break-all">{expert.email}</span>
                        </div>
                        {expert.phone && (
                          <div className="flex items-center gap-2">
                            <Phone className="w-3 h-3 md:w-4 md:h-4 flex-shrink-0" />
                            <span>{expert.phone}</span>
                          </div>
                        )}
                        {expertStatesList.length > 0 && (
                          <div className="flex items-center gap-2 flex-wrap mt-2">
                            <MapPin className="w-3 h-3 md:w-4 md:h-4 flex-shrink-0" />
                            <span className="text-gray-700 font-medium">Specialization:</span>
                            {expertStatesList.map((state) => (
                              <span key={state} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full">
                                {state}
                              </span>
                            ))}
                          </div>
                        )}
                        {expert.expertise && (
                          <div className="mt-2">
                            <span className="text-gray-700 font-medium">Expertise: </span>
                            <span className="text-gray-600 break-words">{expert.expertise}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <Briefcase className="w-3 h-3 md:w-4 md:h-4 flex-shrink-0" />
                          <span>{clientCount} Clients</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div
                    className="relative flex-shrink-0"
                    ref={(el) => {
                      dropdownRefs.current[expert.id] = el
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        handleToggleDropdown(expert.id)
                      }}
                      className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label="More options"
                    >
                      <MoreVertical className="w-4 h-4 md:w-5 md:h-5" />
                    </button>

                    {openDropdownId === expert.id && (
                      <div className="absolute right-0 top-10 z-50 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleViewProfile(expert)
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-blue-600 hover:bg-gray-50 flex items-center gap-2 transition-colors"
                        >
                          <User className="w-4 h-4" />
                          <span>View Profile</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleEditInformation(expert)
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-blue-600 hover:bg-gray-50 flex items-center gap-2 transition-colors"
                        >
                          <Edit className="w-4 h-4" />
                          <span>Edit Information</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleManageClients(expert)
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-blue-600 hover:bg-gray-50 flex items-center gap-2 transition-colors"
                        >
                          <Users className="w-4 h-4" />
                          <span>Manage Clients</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleViewPerformance(expert)
                          }}
                          className="w-full px-4 py-2 text-left text-sm text-blue-600 hover:bg-gray-50 flex items-center gap-2 transition-colors"
                        >
                          <BarChart3 className="w-4 h-4" />
                          <span>View Performance</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleToggleStatus(expert)
                          }}
                          className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2 transition-colors ${
                            expert.status === 'active' ? 'text-red-600' : 'text-green-600'
                          }`}
                        >
                          <UserX className="w-4 h-4" />
                          <span>{expert.status === 'active' ? 'Deactivate' : 'Activate'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        ) : (
          <div className="bg-white rounded-xl p-8 md:p-12 text-center shadow-md border border-gray-100">
            <Briefcase className="w-12 h-12 md:w-16 md:h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 text-base md:text-lg">No experts found</p>
            {(searchInput || selectedState !== 'All States' || selectedStatus !== 'All Status') && (
              <p className="text-sm text-gray-400 mt-2">Try adjusting your search or filters</p>
            )}
          </div>
        )
      }
      </div>
    </div>
  )
}
