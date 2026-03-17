'use client'

import { useState, useEffect, useCallback, Suspense, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import StaffLayout from '@/components/StaffLayout'
import AddCertificationModal from '@/components/AddCertificationModal'
import EditCertificationModal from '@/components/EditCertificationModal'
import { getCertifications, getCertificationTypes } from '@/app/actions/certifications'
import { createClient } from '@/lib/supabase/client'
import * as q from '@/lib/supabase/query'
import { Plus, Edit, Eye, Award, Loader2 } from 'lucide-react'



interface Certification {
  id: string
  type: string
  license_number: string
  state: string | null
  issue_date: string | null
  expiration_date: string
  issuing_authority: string
  status: string
  document_url: string | null
  created_at: string
  updated_at: string
}

function MyCertificationsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const action = searchParams.get('action')
  const [certifications, setCertifications] = useState<Certification[]>([])
  const [certificationTypes, setCertificationTypes] = useState<Array<{ id: number; certification_type: string }>>([])
  const [isLoading, setIsLoading] = useState(true)
  type Column = 'type' | 'status' | 'license_number' | 'issue_date' | 'expiration_date' | 'state'
  const [sortBy, setSortBy] = useState<Column>('expiration_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [selectedCertification, setSelectedCertification] = useState<Certification | null>(null)
  const [loadingCertificationId, setLoadingCertificationId] = useState<string | null>(null)
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [unreadNotifications, setUnreadNotifications] = useState(0)

  useEffect(() => {
    if (action === 'add') {
      setIsModalOpen(true)
    }
  }, [action])

  const loadData = useCallback( async () => {
    
    try {
      const supabase = createClient()
      
      // Get user session
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      if (!currentUser) {
        router.push('/pages/auth/login')
        return
      }
      setUser(currentUser)

      const { data: profileData } = await q.getUserProfileFull(supabase, currentUser.id)
      setProfile(profileData)
      const { count } = await q.getUnreadNotificationsCount(supabase, currentUser.id)
      setUnreadNotifications(count ?? 0)

      // Load certifications and types
      const [certsResult, typesResult] = await Promise.all([
        getCertifications(),
        getCertificationTypes()
      ])

      if (certsResult.data) {
        setCertifications(certsResult.data as Certification[])
      }
      if (typesResult.data) {
        setCertificationTypes(typesResult.data)
      }
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setIsLoading(false)
    }
  }, [router])

  
  useEffect(() => {
    loadData()
  }, [loadData])


  const handleAddSuccess = () => {
    loadData()
  }

  const handleEditClick = (cert: Certification) => {
    setSelectedCertification(cert)
    setIsEditModalOpen(true)
  }

  const handleEditSuccess = () => {
    loadData()
    setIsEditModalOpen(false)
    setSelectedCertification(null)
  }

  const handleViewDetails = (certId: string) => {
    setLoadingCertificationId(certId)
    router.push(`/pages/caregiver/my-certifications/${certId}`)
  }

  const formatDate = (date: string | null) => {
    if (!date) return 'N/A'
    const d = new Date(date)
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  }

  const getStatusBadge = (status: string, expirationDate: string) => {
    const today = new Date()
    const expiry = new Date(expirationDate)
    const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

    if (status === 'Expired' || daysUntilExpiry <= 0) {
      return (
        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
          Expired
        </span>
      )
    } else if (daysUntilExpiry <= 90) {
      return (
        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
          Expiring Soon
        </span>
      )
    } else {
      return (
        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
          Active
        </span>
      )
    }
  }

  const toggleSort = (col: Column) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(col)
      setSortDir('asc')
    }
  }

  const sortedCertifications = useMemo(() => {
    const arr = [...certifications]
    const dir = sortDir === 'asc' ? 1 : -1
    arr.sort((a, b) => {
      try {
        if (sortBy === 'status') return a.status.localeCompare(b.status) * dir
        if (sortBy === 'license_number') return (a.license_number || '').localeCompare(b.license_number || '') * dir
        if (sortBy === 'type') return (a.type || '').localeCompare(b.type || '') * dir
        if (sortBy === 'state') return (a.state || '').localeCompare(b.state || '') * dir
        if (sortBy === 'issue_date') {
          const da = a.issue_date ? new Date(a.issue_date).getTime() : 0
          const db = b.issue_date ? new Date(b.issue_date).getTime() : 0
          return (da - db) * dir
        }
        if (sortBy === 'expiration_date') {
          const da = a.expiration_date ? new Date(a.expiration_date).getTime() : 0
          const db = b.expiration_date ? new Date(b.expiration_date).getTime() : 0
          return (da - db) * dir
        }
      } catch (e) {
        return 0
      }
      return 0
    })
    return arr
  }, [certifications, sortBy, sortDir])

  if (isLoading || !user || !profile) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <StaffLayout 
      user={user} 
      profile={profile} 
      unreadNotifications={unreadNotifications}
    >
      <div className="space-y-6 mt-20">
        {/* Header */}
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">My Certifications</h1>
          <p className="text-gray-600 text-base md:text-lg">
            Manage all your professional certifications and licenses
          </p>
        </div>

        {/* Add New Certification Button */}
        <div className='flex justify-end'>
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-black text-white font-semibold rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Add New Certification
          </button>
        </div>

        {/* Certifications List */}
        {certifications.length > 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
            <table className="min-w-full table-auto">
              <thead>
                <tr className="text-left text-sm text-gray-600">
                  <th className="px-6 py-4">Type
                    <button onClick={() => toggleSort('type')} className="ml-2 text-xs text-gray-400">{sortBy === 'type' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</button>
                  </th>
                  <th className="px-6 py-4">Status
                    <button onClick={() => toggleSort('status')} className="ml-2 text-xs text-gray-400">{sortBy === 'status' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</button>
                  </th>
                  <th className="px-6 py-4">License Number
                    <button onClick={() => toggleSort('license_number')} className="ml-2 text-xs text-gray-400">{sortBy === 'license_number' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</button>
                  </th>
                  <th className="px-6 py-4">Issue Date
                    <button onClick={() => toggleSort('issue_date')} className="ml-2 text-xs text-gray-400">{sortBy === 'issue_date' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</button>
                  </th>
                  <th className="px-6 py-4">Expiration Date
                    {/* <button onClick={() => toggleSort('expiration_date')} className="ml-2 text-xs text-gray-400">{sortBy === 'expiration_date' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</button> */}
                  </th>
                  <th className="px-6 py-4">State
                    <button onClick={() => toggleSort('state')} className="ml-2 text-xs text-gray-400">{sortBy === 'state' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</button>
                  </th>
                  <th className="px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedCertifications.map((cert) => (
                  <tr key={cert.id} className="border-t">
                    <td className="px-6 py-4 align-top">
                      <div className="font-medium text-gray-900">{cert.type}</div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      {getStatusBadge(cert.status, cert.expiration_date)}
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className="text-sm text-gray-900">{cert.license_number}</div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className="text-sm text-gray-900">{formatDate(cert.issue_date)}</div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className="text-sm text-gray-900">{formatDate(cert.expiration_date)}</div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className="text-sm text-gray-900">{cert.state ?? '—'}</div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => handleEditClick(cert)}
                          className="px-3 py-1 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors text-sm flex items-center gap-2"
                        >
                          <Edit className="w-4 h-4" />
                          Edit
                        </button>
                        <button 
                          onClick={() => handleViewDetails(cert.id)}
                          disabled={loadingCertificationId === cert.id}
                          className="px-3 py-1 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {loadingCertificationId === cert.id ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Loading...
                            </>
                          ) : (
                            <>
                              <Eye className="w-4 h-4" />
                              View
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="bg-white rounded-xl p-12 text-center shadow-md border border-gray-100">
            <Award className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No certifications yet</h3>
            <p className="text-gray-600 mb-6">Get started by adding your first certification</p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-black text-white font-semibold rounded-lg hover:bg-gray-800 transition-colors"
            >
              <Plus className="w-5 h-5" />
              Add New Certification
            </button>
          </div>
        )}
      </div>

      {/* Add Certification Modal */}
      <AddCertificationModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleAddSuccess}
        certificationTypes={certificationTypes}
      />

      {/* Edit Certification Modal */}
      {selectedCertification && (
        <EditCertificationModal
          isOpen={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false)
            setSelectedCertification(null)
          }}
          onSuccess={handleEditSuccess}
          certificationTypes={certificationTypes}
          certification={selectedCertification}
        />
      )}
    </StaffLayout>
  )
}

export default function MyCertificationsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <MyCertificationsContent />
    </Suspense>
  )
}
