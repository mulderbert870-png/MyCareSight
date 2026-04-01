'use client'

import { useMemo, useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  MapPin,
  RefreshCw,
  Search,
  ThumbsDown,
  ThumbsUp,
  User,
  XCircle,
} from 'lucide-react'
import Modal from './Modal'
import DeclineAssignmentModal from './DeclineAssignmentModal'
import {
  approveScheduleAssignmentRequestAction,
  assignCaregiverToScheduleAction,
  declineScheduleAssignmentRequestAction,
  markScheduleMissedAction,
  unassignCaregiverFromScheduleAction,
} from '@/app/actions/schedule-assignment-requests'
import type {
  AssignmentRequestCardDTO,
  AssignmentVisitCardDTO,
  ResolvedAssignmentRowDTO,
} from '@/lib/visit-assignment-dashboard'
import type { AllVisitCardDTO, ReassignCandidateDTO, VisitStatus } from '@/lib/visit-all-visits-dashboard'

export type VisitManagementContentProps = {
  visits: AssignmentVisitCardDTO[]
  allVisits: AllVisitCardDTO[]
  allClients: Array<{ id: string; name: string }>
  allCaregivers: Array<{ id: string; name: string }>
  resolved: ResolvedAssignmentRowDTO[]
  approvedTotal: number
  declinedTotal: number
  loadError?: string
}

function formatDistance(miles: number): string {
  if (!Number.isFinite(miles)) return '-'
  if (miles < 10) return `${miles.toFixed(1)} mi`
  return `${Math.round(miles)} mi`
}

function ProgressRow({ label, value, barClass }: { label: string; value: number; barClass: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs font-medium text-gray-600 mb-1">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barClass}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function statusClass(status: VisitStatus): string {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700 border-emerald-200'
  if (status === 'missed') return 'bg-orange-100 text-orange-700 border-orange-200'
  if (status === 'in_progress') return 'bg-blue-100 text-blue-700 border-blue-200'
  if (status === 'unassigned') return 'bg-red-100 text-red-700 border-red-200'
  return 'bg-gray-100 text-gray-700 border-gray-200'
}

function statusLeftBorderClass(status: VisitStatus): string {
  if (status === 'completed') return 'border-l-emerald-500'
  if (status === 'missed') return 'border-l-orange-500'
  if (status === 'in_progress') return 'border-l-blue-500'
  if (status === 'unassigned') return 'border-l-red-500'
  return 'border-l-gray-400'
}

function dateFilterMatch(date: string, dateFilter: string): boolean {
  if (dateFilter === 'all') return true
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(`${date}T00:00:00`)
  if (dateFilter === 'today') return d.getTime() === today.getTime()
  if (dateFilter === 'past') return d < today
  if (dateFilter === 'upcoming') return d >= today
  if (dateFilter === 'next7') {
    const end = new Date(today)
    end.setDate(end.getDate() + 7)
    return d >= today && d <= end
  }
  return true
}

function isPastVisitDate(date: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(`${date}T00:00:00`)
  return d < today
}

function relativeDateHeader(date: string, fallbackLabel: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(`${date}T00:00:00`)
  const diffDays = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return `Today — ${fallbackLabel}`
  if (diffDays === -1) return `Yesterday — ${fallbackLabel}`
  if (diffDays === 1) return `Tomorrow — ${fallbackLabel}`
  return fallbackLabel
}

export default function VisitManagementContent({
  visits,
  allVisits,
  allClients,
  allCaregivers,
  resolved,
  approvedTotal,
  declinedTotal,
  loadError,
}: VisitManagementContentProps) {
  const router = useRouter()
  const [tab, setTab] = useState<'all' | 'requests'>('all')
  const [actionError, setActionError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [declineModal, setDeclineModal] = useState<{ requestId: string; caregiverName: string; clientName: string } | null>(null)
  const [detailVisit, setDetailVisit] = useState<AllVisitCardDTO | null>(null)
  const [reassignVisit, setReassignVisit] = useState<AllVisitCardDTO | null>(null)
  const [missVisit, setMissVisit] = useState<AllVisitCardDTO | null>(null)
  const [missReason, setMissReason] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [clientFilter, setClientFilter] = useState('all')
  const [caregiverFilter, setCaregiverFilter] = useState('all')
  const [sortOrder, setSortOrder] = useState<'oldest' | 'newest'>('oldest')

  const pendingRequestCount = useMemo(() => visits.reduce((sum, v) => sum + v.requests.length, 0), [visits])

  const summary = useMemo(
    () => ({ pending: pendingRequestCount, approved: approvedTotal, declined: declinedTotal }),
    [pendingRequestCount, approvedTotal, declinedTotal]
  )

  const runAction = async (fn: () => Promise<{ ok?: true; error?: string }>) => {
    setActionError(null)
    startTransition(async () => {
      const result = await fn()
      if (result.error) {
        setActionError(result.error)
        return
      }
      router.refresh()
    })
  }

  const clientOptions = useMemo(() => allClients, [allClients])
  const caregiverOptions = useMemo(() => allCaregivers, [allCaregivers])

  const filteredAllVisits = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = allVisits.filter((v) => {
      if (statusFilter !== 'all' && v.status !== statusFilter) return false
      if (!dateFilterMatch(v.date, dateFilter)) return false
      if (clientFilter !== 'all' && v.clientId !== clientFilter) return false
      if (caregiverFilter !== 'all' && (v.caregiverId ?? 'none') !== caregiverFilter) return false
      if (q) {
        const hay = `${v.visitTitle} ${v.clientName} ${v.caregiverName ?? ''} ${v.locationLabel}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    return [...rows].sort((a, b) => {
      const av = `${a.date} ${a.timeLabel}`
      const bv = `${b.date} ${b.timeLabel}`
      return sortOrder === 'oldest' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
  }, [allVisits, search, statusFilter, dateFilter, clientFilter, caregiverFilter, sortOrder])

  const groupedVisits = useMemo(() => {
    const map = new Map<string, { label: string; visits: AllVisitCardDTO[] }>()
    for (const v of filteredAllVisits) {
      const item = map.get(v.date)
      if (item) item.visits.push(v)
      else map.set(v.date, { label: relativeDateHeader(v.date, v.dateLabel), visits: [v] })
    }
    return Array.from(map.entries()).map(([date, v]) => ({ date, ...v }))
  }, [filteredAllVisits])

  useEffect(() => {
    console.log('groupvisits', groupedVisits)
  }, [groupedVisits])


  const handleApprove = (request: AssignmentRequestCardDTO) => void runAction(() => approveScheduleAssignmentRequestAction(request.id))
  const confirmDecline = (reason: string) => {
    if (!declineModal) return
    const id = declineModal.requestId
    setDeclineModal(null)
    void runAction(() => declineScheduleAssignmentRequestAction(id, reason))
  }
  const handleUnassign = (visit: AllVisitCardDTO) => void runAction(() => unassignCaregiverFromScheduleAction(visit.id))
  const handleAssign = (visit: AllVisitCardDTO, caregiverId: string) => {
    setReassignVisit(null)
    void runAction(() => assignCaregiverToScheduleAction(visit.id, caregiverId))
  }
  const handleMiss = () => {
    if (!missVisit) return
    const id = missVisit.id
    const reason = missReason
    setMissVisit(null)
    setMissReason('')
    void runAction(() => markScheduleMissedAction(id, reason))
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {loadError ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</div> : null}
      {actionError ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{actionError}</div> : null}

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Visit Management</h1>
          <p className="text-sm text-gray-600 mt-1">View, sort, and manage all care visits. Assign caregivers and track visit status.</p>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-100/80 p-1 shadow-inner">
          <button type="button" onClick={() => setTab('all')} className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${tab === 'all' ? 'bg-white text-gray-900 shadow' : 'text-gray-600 hover:text-gray-900'}`}>All Visits</button>
          <button type="button" onClick={() => setTab('requests')} className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${tab === 'requests' ? 'bg-white text-gray-900 shadow' : 'text-gray-600 hover:text-gray-900'}`}>
            Assignment Requests
            {pendingRequestCount > 0 ? <span className="rounded-full bg-amber-100 text-amber-800 text-xs font-semibold px-2 py-0.5 min-w-[1.25rem] text-center">{pendingRequestCount}</span> : null}
          </button>
        </div>
      </div>

      {tab === 'all' ? (
        <>
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center justify-between gap-3">
            <span>{pendingRequestCount} assignment requests awaiting your review</span>
            <button type="button" onClick={() => setTab('requests')} className="text-amber-700 font-semibold hover:underline">Click to review</button>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap gap-2 items-center">
            <div className="relative grow min-w-[220px]">
              <Search className="h-4 w-4 text-gray-400 absolute left-3 top-2.5" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by client, caregiver, or visit title..." className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm" />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <option value="all">All Statuses</option>
              <option value="scheduled">Scheduled</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="missed">Missed</option>
              <option value="unassigned">Unassigned</option>
            </select>
            <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <option value="all">All Dates</option>
              <option value="today">Today</option>
              <option value="past">Past Visits</option>
              <option value="upcoming">Upcoming</option>
              <option value="next7">Next 7 Days</option>
            </select>
            <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <option value="all">Client</option>
              {clientOptions.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <select value={caregiverFilter} onChange={(e) => setCaregiverFilter(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <option value="all">Caregiver</option>
              <option value="none">No caregiver assigned</option>
              {caregiverOptions.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as 'oldest' | 'newest')} className="rounded-lg border border-gray-200 px-3 py-2 text-sm ml-auto">
              <option value="oldest">Oldest first</option>
              <option value="newest">Newest first</option>
            </select>
          </div>

          <p className="text-sm text-gray-600">Showing {filteredAllVisits.length} of {allVisits.length} visits</p>

          <div className="space-y-6">
            {groupedVisits.map((group) => {
              const unassignedCount = group.visits.filter((v) => v.status === 'unassigned').length
              return (
                <div key={group.date} className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                    <span>{group.label}</span>
                    <span className="text-gray-500 font-medium">{group.visits.length} visit{group.visits.length > 1 ? 's' : ''}</span>
                    {unassignedCount > 0 ? <span className="text-xs text-red-700 bg-red-100 border border-red-200 rounded-full px-2 py-0.5">{unassignedCount} unassigned</span> : null}
                  </div>
                  {group.visits.map((visit) => {
                    const isPastVisit = isPastVisitDate(visit.date)
                    const isLockedStatus = visit.status === 'completed' || visit.status === 'missed'
                    return (
                    <div key={visit.id} className={`bg-white border rounded-xl p-4 shadow-sm border-l-4 ${statusLeftBorderClass(visit.status)} ${visit.status === 'unassigned' ? 'border-red-200' : 'border-gray-200'}`}>
                      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                        <div className="min-w-[84px] text-sm">
                          <div className="text-xs text-gray-500">{visit.date.slice(5).replace('-', ' / ')}</div>
                          <div className="font-semibold text-gray-900">{visit.timeLabel.split(' - ')[0] || '-'}</div>
                        </div>
                        <div className="flex-1 space-y-2">
                          {/* <div className="font-semibold text-gray-900">{visit.visitTitle}</div> */}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center px-2 py-0.5 text-lg">{visit.adlTasks.length ? visit.adlTasks.join(', ') : 'No ADL tasks'}</span>
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${statusClass(visit.status)}`}>{visit.statusLabel}</span>
                            <span className="inline-flex items-center rounded-full border border-blue-200 text-blue-700 text-xs px-2 py-0.5">{visit.typeLabel}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                            <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5" /> {visit.clientName}</span>
                            <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {visit.locationLabel}</span>
                            <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {visit.timeLabel}</span>
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${visit.caregiverName ? 'border-blue-200 text-blue-700' : 'border-red-200 text-red-700'}`}>
                              {visit.caregiverName ?? 'No caregiver assigned'}
                            </span>
                          </div>
                        </div>
                        <div className="flex lg:flex-col gap-2 lg:w-[130px]">
                          <button type="button" onClick={() => setDetailVisit(visit)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium hover:bg-gray-50">Details</button>
                          {!isPastVisit && !isLockedStatus ? (
                            <>
                              <button type="button" disabled={isPending} onClick={() => setReassignVisit(visit)} className="rounded-lg bg-blue-600 text-white px-3 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
                                {visit.caregiverId ? 'Reassign' : 'Assign'}
                              </button>
                              {visit.caregiverId ? (
                                <button type="button" disabled={isPending} onClick={() => handleUnassign(visit)} className="rounded-lg border border-red-200 text-red-600 px-3 py-2 text-sm font-medium hover:bg-red-50 disabled:opacity-60">Unassign</button>
                              ) : null}
                              <button type="button" disabled={isPending} onClick={() => setMissVisit(visit)} className="rounded-lg border border-orange-200 text-orange-700 px-3 py-2 text-sm font-medium hover:bg-orange-50 disabled:opacity-60">Miss</button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )})}
                </div>
              )
            })}
            {groupedVisits.length === 0 ? <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-500">No visits found for current filters.</div> : null}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-4 flex items-center gap-4 shadow-sm"><div className="rounded-full bg-amber-100 p-3 text-amber-700"><Bell className="h-6 w-6" aria-hidden /></div><div><div className="text-2xl font-bold text-gray-900">{summary.pending}</div><div className="text-sm text-gray-600">Pending Review</div></div></div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-4 flex items-center gap-4 shadow-sm"><div className="rounded-full bg-emerald-100 p-3 text-emerald-700"><CheckCircle2 className="h-6 w-6" aria-hidden /></div><div><div className="text-2xl font-bold text-gray-900">{summary.approved}</div><div className="text-sm text-gray-600">Approved</div></div></div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 flex items-center gap-4 shadow-sm"><div className="rounded-full bg-gray-200 p-3 text-gray-600"><ThumbsDown className="h-6 w-6" aria-hidden /></div><div><div className="text-2xl font-bold text-gray-900">{summary.declined}</div><div className="text-sm text-gray-600">Declined</div></div></div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Pending Requests</h2>
              {pendingRequestCount > 0 ? <span className="text-xs font-medium text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">{pendingRequestCount} awaiting review</span> : null}
            </div>
            {visits.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-500">No pending assignment requests.</div>
            ) : (
              <div className="space-y-6">
                {visits.map((visit) => (
                  <div key={visit.id} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden border-l-4 border-l-amber-300">
                    <div className="bg-amber-50/60 px-4 py-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-amber-100/80">
                      <div>
                        <h3 className="text-lg font-bold text-blue-900">{visit.visitTitle}</h3>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-700">
                          <span className="inline-flex items-center gap-1.5"><User className="h-4 w-4 text-gray-400 shrink-0" aria-hidden />{visit.clientName}</span>
                          <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-gray-400 shrink-0" aria-hidden />{visit.dateLabel}</span>
                          <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 text-gray-400 shrink-0" aria-hidden />{visit.timeLabel}</span>
                          <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-gray-400 shrink-0" aria-hidden />{visit.locationLabel}</span>
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full bg-orange-100 text-orange-800 text-xs font-semibold px-3 py-1">{visit.requests.length} caregiver{visit.requests.length === 1 ? '' : 's'} requested</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {visit.requests.map((req, index) => {
                        const rank = index + 1
                        const isBest = rank === 1 && visit.requests.length > 1
                        return (
                          <div key={req.id} className="p-4 sm:p-5">
                            <div className="flex flex-col lg:flex-row gap-4">
                              <div className="flex gap-3 flex-1 min-w-0">
                                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${rank === 1 ? 'bg-amber-200 text-amber-900' : 'bg-gray-200 text-gray-700'}`}>#{rank}</div>
                                <div className="min-w-0 flex-1 space-y-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-bold text-gray-900">{req.caregiverName}</span>
                                    <span className="text-sm text-gray-600">{req.caregiverTitle}</span>
                                    {isBest ? <span className="text-xs font-semibold text-emerald-700 border border-emerald-300 rounded-full px-2 py-0.5">Best Match</span> : null}
                                  </div>
                                  <div className="grid sm:grid-cols-1 gap-3 max-w-md">
                                    <ProgressRow label="Overall Score" value={req.overallPercent} barClass="bg-blue-500" />
                                    <ProgressRow label="Skill Match" value={req.skillMatchPercent} barClass="bg-violet-500" />
                                    <ProgressRow label="Proximity" value={req.proximityPercent} barClass="bg-emerald-500" />
                                  </div>
                                  {req.matchedSkills.length > 0 ? <div className="flex flex-wrap gap-2">{req.matchedSkills.map((sk) => <span key={sk} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800 border border-emerald-300 bg-emerald-50 rounded-md px-2 py-0.5"><CheckCircle2 className="h-3 w-3" aria-hidden /> {sk}</span>)}</div> : null}
                                  <p className="text-xs text-gray-600 inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />{formatDistance(req.distanceMiles)} away - {req.cityLabel}</p>
                                  {req.note ? <div className="rounded-lg bg-sky-50 border border-sky-100 px-3 py-2 text-sm text-sky-950"><span className="font-medium text-sky-900">Note: </span>{req.note}</div> : null}
                                  <p className="text-xs text-gray-400">Requested {req.requestedAtLabel}</p>
                                </div>
                              </div>
                              <div className="flex lg:flex-col gap-2 shrink-0 lg:items-stretch">
                                <button type="button" disabled={isPending} onClick={() => handleApprove(req)} className="inline-flex flex-1 lg:flex-none items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"><ThumbsUp className="h-4 w-4" aria-hidden />Approve & Assign</button>
                                <button type="button" disabled={isPending} onClick={() => setDeclineModal({ requestId: req.id, caregiverName: req.caregiverName, clientName: visit.clientName })} className="inline-flex flex-1 lg:flex-none items-center justify-center gap-2 rounded-lg border-2 border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"><ThumbsDown className="h-4 w-4" aria-hidden />Decline</button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {resolved.length > 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50/80"><RefreshCw className="h-4 w-4 text-gray-500" aria-hidden /><h2 className="text-sm font-semibold text-gray-800">Recently Resolved</h2></div>
              <ul className="divide-y divide-gray-100">
                {resolved.map((row) => (
                  <li key={row.id} className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3 text-sm">
                    <div className="flex items-start gap-3 flex-1 min-w-0">{row.kind === 'approved' ? <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden /> : <XCircle className="h-5 w-5 text-gray-400 shrink-0 mt-0.5" aria-hidden />}<div className="min-w-0"><span className="font-medium text-gray-900">{row.caregiverName}</span><span className="text-gray-600"> — {row.visitTitle} — {row.clientName} — {row.visitDateLabel}</span></div></div>
                    <div className="flex items-center gap-2 sm:shrink-0 pl-8 sm:pl-0"><span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${row.kind === 'approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-700'}`}>{row.kind === 'approved' ? 'Approved' : 'Declined'}</span><span className="text-xs text-gray-500">{row.resolvedAtLabel}</span></div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      <DeclineAssignmentModal isOpen={!!declineModal} onClose={() => setDeclineModal(null)} caregiverName={declineModal?.caregiverName ?? ''} clientName={declineModal?.clientName ?? ''} onConfirm={confirmDecline} />

      <Modal isOpen={!!detailVisit} onClose={() => setDetailVisit(null)} title="Visit Details" size="md">
        {detailVisit ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>{detailVisit.clientName}</span>
              <span>-</span>
              <span>{detailVisit.dateLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClass(detailVisit.status)}`}>{detailVisit.statusLabel}</span>
              <span className="rounded-full border border-blue-200 text-blue-700 px-2 py-0.5 text-xs">{detailVisit.typeLabel}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-gray-50 p-3"><div className="text-xs text-gray-500">Client</div><div className="font-semibold">{detailVisit.clientName}</div></div>
              <div className="rounded-lg bg-gray-50 p-3"><div className="text-xs text-gray-500">Location</div><div className="font-semibold">{detailVisit.locationLabel}</div></div>
              <div className="rounded-lg bg-gray-50 p-3"><div className="text-xs text-gray-500">Time</div><div className="font-semibold">{detailVisit.timeLabel}</div></div>
              <div className="rounded-lg bg-gray-50 p-3"><div className="text-xs text-gray-500">Caregiver</div><div className="font-semibold">{detailVisit.caregiverName ?? '-'}</div></div>
            </div>
            <div><div className="text-xs text-gray-500 mb-1">ADL Tasks</div><div className="flex flex-wrap gap-2">{detailVisit.adlTasks.length ? detailVisit.adlTasks.map((task) => <span key={task} className="rounded-full border border-purple-200 text-purple-700 bg-purple-50 px-2 py-0.5 text-xs">{task}</span>) : <span className="text-sm text-gray-500">No ADL tasks</span>}</div></div>
            {detailVisit.status !== 'completed' && detailVisit.status !== 'missed' && !isPastVisitDate(detailVisit.date) ? (
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setMissVisit(detailVisit)} className="rounded-lg border border-orange-200 text-orange-700 px-3 py-2 text-sm font-medium hover:bg-orange-50">Mark Missed</button>
                <button type="button" onClick={() => setReassignVisit(detailVisit)} className="rounded-lg bg-blue-600 text-white px-3 py-2 text-sm font-medium hover:bg-blue-700">{detailVisit.caregiverId ? 'Reassign Caregiver' : 'Assign Caregiver'}</button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={!!reassignVisit} onClose={() => setReassignVisit(null)} title="Assign Caregiver" size="lg">
        {reassignVisit ? (
          <div className="space-y-4">
            <div className="text-sm text-gray-600">{reassignVisit.clientName} - {reassignVisit.visitTitle} - {reassignVisit.timeLabel}</div>
            <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
              <div className="text-xs font-semibold text-purple-700 mb-2">Client Required Skills</div>
              <div className="flex flex-wrap gap-2">{reassignVisit.clientRequiredSkills.length ? reassignVisit.clientRequiredSkills.map((sk) => <span key={sk} className="rounded-full bg-white border border-purple-200 text-purple-700 px-2 py-0.5 text-xs">{sk}</span>) : <span className="text-xs text-purple-600">No required skills</span>}</div>
            </div>
            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
              {reassignVisit.reassignCandidates.map((cand: ReassignCandidateDTO, idx) => (
                <div key={cand.id} className={`rounded-xl border p-3 ${cand.isCurrent ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200 bg-white'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2"><span className="text-sm font-bold text-gray-700">#{idx + 1}</span><span className="font-semibold text-gray-900">{cand.caregiverName}</span><span className="text-sm text-gray-600">{cand.caregiverTitle}</span>{cand.isCurrent ? <span className="rounded-full border border-blue-200 text-blue-700 bg-blue-100 px-2 py-0.5 text-xs">Currently Assigned</span> : null}</div>
                      <div className="max-w-sm mt-2"><ProgressRow label="Overall Score" value={cand.overallPercent} barClass="bg-blue-500" /><ProgressRow label="Skill Match" value={cand.skillMatchPercent} barClass="bg-violet-500" /><ProgressRow label="Proximity" value={cand.proximityPercent} barClass="bg-emerald-500" /></div>
                      <div className="mt-2 text-xs text-gray-600">{formatDistance(cand.distanceMiles)} away</div>
                      {cand.matchedSkills.length ? <div className="flex flex-wrap gap-2 mt-2">{cand.matchedSkills.map((sk) => <span key={sk} className="rounded-full border border-emerald-200 text-emerald-700 bg-emerald-50 px-2 py-0.5 text-xs">{sk}</span>)}</div> : null}
                    </div>
                    <button type="button" 
                      onClick={() => {
                        if (cand.isCurrent) {
                          setReassignVisit(null)
                        } else {
                          handleAssign(reassignVisit, cand.id)
                        }         
                      }}
                      className={`rounded-lg text-white px-3 py-2 text-sm font-medium ${cand.isCurrent ? 'bg-blue-600 hover:bg-blue-700' : 'bg-black hover:bg-gray-800 '}`}>
                        {cand.isCurrent ? 'Keep' : 'Assign'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={!!missVisit} onClose={() => { setMissVisit(null); setMissReason('') }} title="Mark Visit as Missed" size="md">
        {missVisit ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
              <div className="font-semibold">{missVisit.clientName}</div>
              <div>{missVisit.visitTitle}</div>
              <div>{missVisit.dateLabel}, {missVisit.timeLabel}</div>
              <div>Caregiver: {missVisit.caregiverName ?? 'Unassigned'}</div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Reason (optional)</label>
              <textarea value={missReason} onChange={(e) => setMissReason(e.target.value)} placeholder="e.g. Client hospitalized, caregiver no-show, weather..." rows={4} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">This will be logged with your name and timestamp and will appear in missed-visit reports.</div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setMissVisit(null); setMissReason('') }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium">Cancel</button>
              <button type="button" disabled={isPending} onClick={handleMiss} className="rounded-lg bg-orange-600 text-white px-4 py-2 text-sm font-medium hover:bg-orange-700 disabled:opacity-60">Confirm Missed</button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
