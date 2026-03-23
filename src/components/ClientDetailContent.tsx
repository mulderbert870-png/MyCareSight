'use client'

import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { 
  ArrowLeft, 
  ChevronLeft, 
  ChevronRight,
  Edit,
  Phone,
  Mail,
  MapPin,
  Calendar,
  User,
  Users,
  Plus,
  AlertCircle,
  AlertTriangle,
  Loader2,
  FileText,
  Trash2,
  ExternalLink,
  Sparkles,
  Save,
  Upload,
  Download,
  Search,
  ClipboardList,
  Infinity,
  Check,
  Clock,
  TrendingUp,
  X,
  Timer,
  SquareArrowOutUpRight,
  History
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import * as q from '@/lib/supabase/query'
import { updatePatientDocumentsAction } from '@/app/actions/patients'
import type { PatientRepresentative } from '@/lib/supabase/query/patients-representatives'
import type { PatientDocument } from '@/lib/supabase/query/patients'
import type { CaregiverRequirement } from '@/lib/supabase/query/caregiver-requirements'
import type { PatientIncident } from '@/lib/supabase/query/patient-incidents'
import type { PatientAdl, PatientAdlDaySchedule } from '@/lib/supabase/query/patient-adls'
import type { ScheduleRow } from '@/lib/supabase/query/schedules'
import type { PatientContractedHoursRow } from '@/lib/supabase/query/patient-contracted-hours'
import { CAREGIVER_SKILL_POINTS, ADL_LISTS } from '@/lib/constants'
import Modal from '@/components/Modal'
import zipcodes from 'zipcodes'

const VISIT_TYPES = ['Routine', 'Medical', 'Therapy', 'Social', 'Other'] as const

/** Safe filename for the browser download attribute (original name minus illegal characters). */
function sanitizeDownloadFilename(name: string): string {
  const base = name.trim() || 'document'
  return base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 255)
}

/** Order used in Add/Edit Visit → ADLs tab when ADL plan uses specific times (morning…night). */
const ADL_VISIT_TIME_SLOTS = [
  { key: 'morning' as const, label: 'Morning' },
  { key: 'afternoon' as const, label: 'Afternoon' },
  { key: 'evening' as const, label: 'Evening' },
  { key: 'night' as const, label: 'Night' },
]

function scheduleHasAdlSlot(
  schedule: PatientAdlDaySchedule | undefined,
  slotKey: (typeof ADL_VISIT_TIME_SLOTS)[number]['key']
): boolean {
  if (!schedule || schedule.schedule_type !== 'specific_times') return false
  switch (slotKey) {
    case 'morning':
      return !!schedule.slot_morning
    case 'afternoon':
      return !!schedule.slot_afternoon
    case 'evening':
      return !!schedule.slot_evening
    case 'night':
      return !!schedule.slot_night
    default:
      return false
  }
}

/** Stored in schedules.adl_codes so the same ADL can be chosen per time slot independently. */
const VISIT_ADL_SLOT_SEP = '::'

function dayOfWeekDbFromDateStr(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00').getDay()
  return d === 0 ? 7 : d
}

function encodeVisitAdlSlotKey(slotKey: string, adlCode: string): string {
  return `${slotKey}${VISIT_ADL_SLOT_SEP}${adlCode}`
}

/** Legacy rows used plain ADL names; map to one slot key for this weekday. */
function expandLegacyVisitAdlToken(
  adlCode: string,
  dayOfWeekDb: number,
  schedules: PatientAdlDaySchedule[]
): string {
  const s = schedules.find((x) => x.adl_code === adlCode && x.day_of_week === dayOfWeekDb)
  if (!s || s.schedule_type === 'never') return encodeVisitAdlSlotKey('any', adlCode)
  if (s.schedule_type === 'always') return encodeVisitAdlSlotKey('any', adlCode)
  if (s.schedule_type === 'as_needed') return encodeVisitAdlSlotKey('as_needed', adlCode)
  for (const { key } of ADL_VISIT_TIME_SLOTS) {
    if (scheduleHasAdlSlot(s, key)) return encodeVisitAdlSlotKey(key, adlCode)
  }
  return encodeVisitAdlSlotKey('any', adlCode)
}

function normalizeScheduleAdlToken(
  token: string,
  dayOfWeekDb: number,
  schedules: PatientAdlDaySchedule[]
): string {
  if (token.includes(VISIT_ADL_SLOT_SEP)) return token
  return expandLegacyVisitAdlToken(token, dayOfWeekDb, schedules)
}

function buildAssignedVisitAdlSlotSet(
  rows: ScheduleRow[],
  schedules: PatientAdlDaySchedule[]
): Set<string> {
  const set = new Set<string>()
  for (const row of rows) {
    const dow = dayOfWeekDbFromDateStr(row.date)
    for (const token of row.adl_codes ?? []) {
      set.add(normalizeScheduleAdlToken(token, dow, schedules))
    }
  }
  return set
}

interface SmallClient {
  id: string
  full_name: string
  date_of_birth: string
  age: number | null
  gender: string | null
  class: string | null
  street_address: string
  city: string
  state: string
  zip_code: string
  phone_number: string
  email_address: string
  emergency_contact_name: string
  emergency_phone: string
  primary_diagnosis: string | null
  current_medications: string | null
  allergies: string | null
  representative_1_name: string | null
  representative_1_relationship: string | null
  representative_1_phone: string | null
  representative_2_name: string | null
  representative_2_relationship: string | null
  representative_2_phone: string | null
  status: 'active' | 'inactive'
  login_access?: boolean
  documents?: PatientDocument[] | null
  created_at: string
}

type StaffMember = { id: string; user_id?: string; first_name?: string; last_name?: string; [key: string]: unknown }

interface ClientDetailContentProps {
  client: SmallClient
  allClients: Array<{ id: string; full_name: string }>
  representatives?: PatientRepresentative[]
  caregiverRequirements?: CaregiverRequirement | null
  incidents?: PatientIncident[] | null
  adls?: PatientAdl[] | null
  adlSchedules?: PatientAdlDaySchedule[] | null
  staff?: StaffMember[] | null
  contractedHours?: PatientContractedHoursRow[] | null
}

export default function ClientDetailContent({ client, allClients, representatives = [], caregiverRequirements: initialCaregiverRequirements = null, 
  incidents: initialIncidents = [], adls: initialAdls = [], adlSchedules: initialAdlSchedules = [], staff: staffList = [], 
  contractedHours: initialContractedHours = [] }: ClientDetailContentProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab')
  const [isClientSwitching, setIsClientSwitching] = useState(false)
  const [localClient, setLocalClient] = useState<SmallClient>(client)
  const [activeTab, setActiveTab] = useState(tab ?? 'overview')
  const [clientStatus, setClientStatus] = useState(client.status)
  const [loginAccess, setLoginAccess] = useState(client.login_access ?? true)
  const [isEditingPersonal, setIsEditingPersonal] = useState(false)
  const [editPersonalForm, setEditPersonalForm] = useState({
    full_name: client.full_name,
    gender: client.gender ?? '',
    date_of_birth: client.date_of_birth,
    age: client.age ?? 0,
  })
  const [isSavingPersonal, setIsSavingPersonal] = useState(false)
  const [personalEditError, setPersonalEditError] = useState<string | null>(null)
  const [isEditingMedical, setIsEditingMedical] = useState(false)
  const [editMedicalForm, setEditMedicalForm] = useState({
    primary_diagnosis: client.primary_diagnosis ?? '',
    current_medications: client.current_medications ?? '',
    allergies: client.allergies ?? '',
  })
  const [isSavingMedical, setIsSavingMedical] = useState(false)
  const [medicalEditError, setMedicalEditError] = useState<string | null>(null)
  const [repModalOpen, setRepModalOpen] = useState(false)
  const [repModalSlot, setRepModalSlot] = useState<number>(1)
  const [repModalMode, setRepModalMode] = useState<'add' | 'edit'>('add')
  const [repModalEditingId, setRepModalEditingId] = useState<string | null>(null)
  const [repForm, setRepForm] = useState({ name: '', relationship: '', phone_number: '', email_address: '' })
  const [isSavingRep, setIsSavingRep] = useState(false)
  const [repFormError, setRepFormError] = useState<string | null>(null)
  const [deletingRepId, setDeletingRepId] = useState<string | null>(null)
  const [repToDelete, setRepToDelete] = useState<PatientRepresentative | null>(null)
  const [adlToDelete, setAdlToDelete] = useState<string | null>(null)
  const [pendingAdlDeletes, setPendingAdlDeletes] = useState<string[]>([])
  const [docToDelete, setDocToDelete] = useState<PatientDocument | null>(null)
  const [repListError, setRepListError] = useState<string | null>(null)
  const [localRepresentatives, setLocalRepresentatives] = useState<PatientRepresentative[]>(representatives)
  const [documentUploadError, setDocumentUploadError] = useState<string | null>(null)
  const [isUploadingDocument, setIsUploadingDocument] = useState(false)
  const [isDeletingDocId, setIsDeletingDocId] = useState<string | null>(null)
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null)
  const documentFileInputRef = useRef<HTMLInputElement>(null)
  const primaryDiagnosisInputRef = useRef<HTMLInputElement>(null)
  const [caregiverRequirements, setCaregiverRequirements] = useState<string[]>(initialCaregiverRequirements?.skill_codes ?? [])
  const [caregiverReqsModalOpen, setCaregiverReqsModalOpen] = useState(false)
  const [caregiverReqsSelection, setCaregiverReqsSelection] = useState<string[]>([])
  const [caregiverReqsSearch, setCaregiverReqsSearch] = useState('')
  const [caregiverReqsDropdownOpen, setCaregiverReqsDropdownOpen] = useState<string | null>(null)
  /** Only the category row whose dropdown is open (toggle + panel + chips). */
  const caregiverReqsOpenCategoryRef = useRef<HTMLDivElement>(null)
  const [isSavingCaregiverReqs, setIsSavingCaregiverReqs] = useState(false)
  const [caregiverReqsError, setCaregiverReqsError] = useState<string | null>(null)
  const [localIncidents, setLocalIncidents] = useState<PatientIncident[]>(initialIncidents ?? [])
  const [incidentModalOpen, setIncidentModalOpen] = useState(false)
  const [incidentForm, setIncidentForm] = useState({
    incident_date: '',
    reporting_date: '',
    primary_contact_person: '',
    description: '',
  })
  const [incidentFormFile, setIncidentFormFile] = useState<File | null>(null)
  const incidentFileInputRef = useRef<HTMLInputElement>(null)
  const [isSavingIncident, setIsSavingIncident] = useState(false)
  const [incidentFormError, setIncidentFormError] = useState<string | null>(null)
  const [incidentListError, setIncidentListError] = useState<string | null>(null)
  const [deletingIncidentId, setDeletingIncidentId] = useState<string | null>(null)
  const [downloadingIncidentId, setDownloadingIncidentId] = useState<string | null>(null)
  const [localAdls, setLocalAdls] = useState<PatientAdl[]>(initialAdls ?? [])
  const [localAdlSchedules, setLocalAdlSchedules] = useState<PatientAdlDaySchedule[]>(initialAdlSchedules ?? [])
  const [addAdlModalOpen, setAddAdlModalOpen] = useState(false)
  const [addAdlSearch, setAddAdlSearch] = useState('')
  const [addAdlSelected, setAddAdlSelected] = useState<Set<string>>(new Set())
  const [isSavingAddAdl, setIsSavingAddAdl] = useState(false)
  const [addAdlError, setAddAdlError] = useState<string | null>(null)
  const [selectTimeModalOpen, setSelectTimeModalOpen] = useState(false)
  const [selectTimeAdl, setSelectTimeAdl] = useState<{ name: string; group: string } | null>(null)
  const [selectTimeDay, setSelectTimeDay] = useState<number>(1)
  const [selectTimeDayLabel, setSelectTimeDayLabel] = useState<string>('Monday')
  const [adlNoteModalOpen, setAdlNoteModalOpen] = useState(false)
  const [adlNoteTarget, setAdlNoteTarget] = useState<{ name: string; group: string } | null>(null)
  const [adlNoteDraft, setAdlNoteDraft] = useState('')
  const [selectTimeForm, setSelectTimeForm] = useState({
    timesPerDay: 1 as 1 | 2 | 3 | 4,
    morning: false,
    afternoon: false,
    evening: false,
    night: false,
    slotMorning: 'always' as 'always' | 'as_needed',
    slotAfternoon: 'always' as 'always' | 'as_needed',
    slotEvening: 'always' as 'always' | 'as_needed',
    slotNight: 'always' as 'always' | 'as_needed',
  })
  const [isSavingAdlPlan, setIsSavingAdlPlan] = useState(false)
  const [adlPlanError, setAdlPlanError] = useState<string | null>(null)
  const [deletingAdlCode, setDeletingAdlCode] = useState<string | null>(null)

  const getMonday = (d: Date) => {
    const date = new Date(d)
    const day = date.getDay()
    const diff = day === 0 ? -6 : 1 - day
    date.setDate(date.getDate() + diff)
    return date
  }
  /** YYYY-MM-DD in local time (so schedule grid and ADL day_of_week 1=Mon..7=Sun match). */
  const toLocalDateString = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const [scheduleWeekStart, setScheduleWeekStart] = useState<Date>(() => getMonday(new Date()))
  const [weekSchedules, setWeekSchedules] = useState<ScheduleRow[]>([])
  const [scheduleHover, setScheduleHover] = useState<{ dateStr: string; startHour: number; endHourExclusive: number } | null>(null)
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [addVisitModalOpen, setAddVisitModalOpen] = useState(false)
  const [addVisitTab, setAddVisitTab] = useState<'details' | 'adls'>('details')
  const [visitForm, setVisitForm] = useState({
    date: '',
    startTime: '09:00',
    endTime: '10:00',
    description: '',
    type: 'Routine' as string,
    caregiverId: '',
    notes: '',
    isRecurring: false,
    repeatFrequency: '',
    repeatDays: [] as number[],
    repeatMonthlyRules: [] as { ordinal: number | null; weekday: number | null }[],
    repeatStart: '',
    repeatEnd: '',
  })
  const [visitAdlSelected, setVisitAdlSelected] = useState<Set<string>>(new Set())
  const [isSavingVisit, setIsSavingVisit] = useState(false)
  const [visitError, setVisitError] = useState<string | null>(null)
  const [manageLimitModalOpen, setManageLimitModalOpen] = useState(false)
  const [limitForm, setLimitForm] = useState({ totalHours: '', effectiveDate: '', note: '' })
  const [localContractedHours, setLocalContractedHours] = useState<PatientContractedHoursRow[]>(initialContractedHours ?? [])
  const [isSavingLimit, setIsSavingLimit] = useState(false)
  const [limitError, setLimitError] = useState<string | null>(null)
  const [scheduleLimitWarning, setScheduleLimitWarning] = useState<string | null>(null)
  const [visitDateSchedules, setVisitDateSchedules] = useState<ScheduleRow[]>([])
  const [editVisitModalOpen, setEditVisitModalOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<ScheduleRow | null>(null)

  // Caregiver dropdown (Add/Edit Visit modal, Schedule tab).
  const [caregiverPickerOpen, setCaregiverPickerOpen] = useState(false)
  const [caregiverPickerFilter, setCaregiverPickerFilter] = useState<'all' | 'available' | 'booked' | 'blocked'>('all')
  const caregiverPickerWrapRef = useRef<HTMLDivElement | null>(null)
  const caregiverPickerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const caregiverPickerDropdownRef = useRef<HTMLDivElement | null>(null)
  /** Fixed position for portaled menu (above trigger), so it can extend past the modal without clipping. */
  const [caregiverPickerMenuFixed, setCaregiverPickerMenuFixed] = useState<{
    left: number
    bottom: number
    width: number
  } | null>(null)

  useLayoutEffect(() => {
    if (!caregiverPickerOpen) {
      setCaregiverPickerMenuFixed(null)
      return
    }
    const update = () => {
      const btn = caregiverPickerTriggerRef.current
      if (!btn || typeof window === 'undefined') return
      const r = btn.getBoundingClientRect()
      const margin = 8
      const minMenuWidth = 500
      let width = Math.max(r.width, minMenuWidth)
      width = Math.min(width, window.innerWidth - margin * 2)
      let left = r.left
      if (left + width > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - width - margin)
      }
      setCaregiverPickerMenuFixed({
        left,
        width,
        bottom: window.innerHeight - r.top + margin,
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [caregiverPickerOpen])

  useEffect(() => {
    if (!caregiverPickerOpen) return
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target
      if (!(t instanceof Node)) return
      const wrap = caregiverPickerWrapRef.current
      const menu = caregiverPickerDropdownRef.current
      if (wrap?.contains(t) || menu?.contains(t)) return
      setCaregiverPickerOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [caregiverPickerOpen])

  // Required caregiver skills modal: close dropdown when clicking outside that category (not whole scroll list).
  useEffect(() => {
    if (!caregiverReqsModalOpen || caregiverReqsDropdownOpen == null) return
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target
      if (!(t instanceof Node)) return
      const root = caregiverReqsOpenCategoryRef.current
      if (root && !root.contains(t)) {
        setCaregiverReqsDropdownOpen(null)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [caregiverReqsModalOpen, caregiverReqsDropdownOpen])

  // Sync local client when switching to a different client (by id)
  useEffect(() => {
    setLocalClient(client)
  }, [client.id])

  useEffect(() => {
    setIsClientSwitching(false)
  }, [client.id])

  // Sync local representatives when prop changes (e.g. after router.refresh or navigation)
  useEffect(() => {
    setLocalRepresentatives(representatives)
  }, [client.id, representatives])

  useEffect(() => {
    setCaregiverRequirements(initialCaregiverRequirements?.skill_codes ?? [])
  }, [client.id, initialCaregiverRequirements])

  useEffect(() => {
    setLocalIncidents(initialIncidents ?? [])
  }, [client.id, initialIncidents])

  useEffect(() => {
    setLocalAdls(initialAdls ?? [])
    setLocalAdlSchedules(initialAdlSchedules ?? [])
  }, [client.id, initialAdls, initialAdlSchedules])

  useEffect(() => {
    setLocalContractedHours(initialContractedHours ?? [])
  }, [client.id, initialContractedHours])

  useEffect(() => {
    setPendingAdlDeletes([])
  }, [client.id])

  useEffect(() => {
    setActiveTab(tab ?? 'overview')
  }, [tab])

  const scheduleWeekEnd = new Date(scheduleWeekStart)
  scheduleWeekEnd.setDate(scheduleWeekEnd.getDate() + 6)
  const scheduleWeekStartStr = toLocalDateString(scheduleWeekStart)
  const scheduleWeekEndStr = toLocalDateString(scheduleWeekEnd)

  useEffect(() => {
    if (activeTab !== 'schedule') return
    setScheduleLoading(true)
    const supabase = createClient()
    q.getSchedulesByPatientIdAndDateRange(supabase, localClient.id, scheduleWeekStartStr, scheduleWeekEndStr)
      .then(({ data }) => { setWeekSchedules(data ?? []) })
      .finally(() => setScheduleLoading(false))
  }, [activeTab, localClient.id, scheduleWeekStartStr, scheduleWeekEndStr])

  useEffect(() => {
    const dateForFetch = visitForm.isRecurring ? visitForm.repeatStart : visitForm.date
    if ((!addVisitModalOpen && !editVisitModalOpen) || !dateForFetch) {
      setVisitDateSchedules([])
      return
    }
    const supabase = createClient()
    q.getSchedulesByPatientIdAndDateRange(supabase, localClient.id, dateForFetch, dateForFetch).then(
      ({ data }) => setVisitDateSchedules(data ?? [])
    )
  }, [addVisitModalOpen, editVisitModalOpen, localClient.id, visitForm.date, visitForm.isRecurring, visitForm.repeatStart])

  useEffect(() => {
    if (isEditingMedical) {
      primaryDiagnosisInputRef.current?.focus()
    }
  }, [isEditingMedical])

  const sortedRepresentatives = [...localRepresentatives].sort((a, b) => a.display_order - b.display_order)
  const nextRepDisplayOrder = sortedRepresentatives.length === 0
    ? 1
    : Math.max(...sortedRepresentatives.map((r) => r.display_order), 0) + 1

  // Sync from server after refresh
  useEffect(() => {
    setClientStatus(client.status)
    setLoginAccess(client.login_access ?? true)
  }, [client.id, client.status, client.login_access])

  // Find current client index
  const currentIndex = allClients.findIndex(c => c.id === localClient.id)
  const previousClient = currentIndex > 0 ? allClients[currentIndex - 1] : null
  const nextClient = currentIndex < allClients.length - 1 ? allClients[currentIndex + 1] : null

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const parseDateOnly = (dateString: string): Date => {
    const s = (dateString ?? '').slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split('-').map(Number)
      return new Date(y, m - 1, d)
    }
    return new Date(dateString)
  }

  const formatDate = (dateString: string) => {
    const date = parseDateOnly(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const formatShortDate = (dateString: string) => {
    const date = parseDateOnly(dateString)
    return date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    })
  }

  const ageFromDob = (dateOfBirth: string) => {
    const dob = new Date(dateOfBirth)
    const today = new Date()
    let age = today.getFullYear() - dob.getFullYear()
    const m = today.getMonth() - dob.getMonth()
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--
    return Math.max(0, age)
  }

  const dobFromAge = (age: number) => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - age)
    return toLocalDateString(d)
  }

  const handleStatusToggle = async (newStatus: 'active' | 'inactive') => {
    setClientStatus(newStatus)
    
    try {
      const supabase = createClient()
      const { error } = await q.updatePatientStatus(supabase, client.id, newStatus)

      if (error) {
        console.error('Error updating status:', error)
        setClientStatus(client.status) // Revert on error
      } else {
        router.refresh()
      }
    } catch (error) {
      console.error('Error updating status:', error)
      setClientStatus(client.status) // Revert on error
    }
  }

  const handleLoginAccessToggle = async (checked: boolean) => {
    setLoginAccess(checked)
    try {
      const supabase = createClient()
      const { error } = await q.updatePatientLoginAccess(supabase, client.id, checked)
      if (error) {
        console.error('Error updating login access:', error)
        setLoginAccess(!checked)
      } else {
        router.refresh()
      }
    } catch (error) {
      console.error('Error updating login access:', error)
      setLoginAccess(!checked)
    }
  }

  const startEditPersonal = () => {
    const age = localClient.age ?? ageFromDob(localClient.date_of_birth)
    setEditPersonalForm({
      full_name: localClient.full_name,
      gender: localClient.gender ?? '',
      date_of_birth: localClient.date_of_birth,
      age,
    })
    setPersonalEditError(null)
    setIsEditingPersonal(true)
  }

  const cancelEditPersonal = () => {
    setIsEditingPersonal(false)
    setPersonalEditError(null)
  }

  const handleSavePersonal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editPersonalForm.full_name.trim()) {
      setPersonalEditError('Full name is required.')
      return
    }
    setIsSavingPersonal(true)
    setPersonalEditError(null)
    try {
      const supabase = createClient()
      const { error } = await q.updatePatient(supabase, client.id, {
        full_name: editPersonalForm.full_name.trim(),
        gender: editPersonalForm.gender || null,
        date_of_birth: editPersonalForm.date_of_birth,
      })
      if (error) throw error
      const newAge = editPersonalForm.date_of_birth ? ageFromDob(editPersonalForm.date_of_birth) : localClient.age
      setLocalClient((prev) => ({
        ...prev,
        full_name: editPersonalForm.full_name.trim(),
        gender: editPersonalForm.gender || null,
        date_of_birth: editPersonalForm.date_of_birth,
        age: newAge,
      }))
      setIsEditingPersonal(false)
      router.refresh()
    } catch (err: unknown) {
      setPersonalEditError(err instanceof Error ? err.message : 'Failed to update. Please try again.')
    } finally {
      setIsSavingPersonal(false)
    }
  }

  const startEditMedical = () => {
    setEditMedicalForm({
      primary_diagnosis: localClient.primary_diagnosis ?? '',
      current_medications: localClient.current_medications ?? '',
      allergies: localClient.allergies ?? '',
    })
    setMedicalEditError(null)
    setIsEditingMedical(true)
  }

  const cancelEditMedical = () => {
    setIsEditingMedical(false)
    setMedicalEditError(null)
  }

  const handleSaveMedical = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSavingMedical(true)
    setMedicalEditError(null)
    try {
      const supabase = createClient()
      const { error } = await q.updatePatientMedical(supabase, client.id, {
        primary_diagnosis: editMedicalForm.primary_diagnosis.trim() || null,
        current_medications: editMedicalForm.current_medications.trim() || null,
        allergies: editMedicalForm.allergies.trim() || null,
      })
      if (error) throw error
      setLocalClient((prev) => ({
        ...prev,
        primary_diagnosis: editMedicalForm.primary_diagnosis.trim() || null,
        current_medications: editMedicalForm.current_medications.trim() || null,
        allergies: editMedicalForm.allergies.trim() || null,
      }))
      setIsEditingMedical(false)
      router.refresh()
    } catch (err: unknown) {
      setMedicalEditError(err instanceof Error ? err.message : 'Failed to update. Please try again.')
    } finally {
      setIsSavingMedical(false)
    }
  }

  const openAddRep = (displayOrder: number) => {
    setRepModalSlot(displayOrder)
    setRepModalMode('add')
    setRepModalEditingId(null)
    setRepForm({ name: '', relationship: '', phone_number: '', email_address: '' })
    setRepFormError(null)
    setRepListError(null)
    setRepModalOpen(true)
  }

  const openEditRep = (rep: PatientRepresentative) => {
    setRepModalSlot(rep.display_order)
    setRepModalMode('edit')
    setRepModalEditingId(rep.id)
    setRepForm({
      name: rep.name ?? '',
      relationship: rep.relationship ?? '',
      phone_number: rep.phone_number ?? '',
      email_address: rep.email_address ?? '',
    })
    setRepFormError(null)
    setRepListError(null)
    setRepModalOpen(true)
  }

  const closeRepModal = () => {
    if (!isSavingRep) {
      setRepModalOpen(false)
      setRepFormError(null)
    }
  }

  const confirmDeleteRep = (rep: PatientRepresentative) => {
    setRepListError(null)
    setRepToDelete(rep)
  }

  const handleDeleteRep = async () => {
    if (!repToDelete) return
    const rep = repToDelete
    setDeletingRepId(rep.id)
    setRepListError(null)
    try {
      const supabase = createClient()
      const { error } = await q.deleteRepresentative(supabase, rep.id)
      if (error) throw error
      setLocalRepresentatives((prev) => prev.filter((r) => r.id !== rep.id))
      setRepToDelete(null)
      router.refresh()
    } catch (err: unknown) {
      setRepListError(err instanceof Error ? err.message : 'Failed to delete representative.')
    } finally {
      setDeletingRepId(null)
    }
  }

  const handleSaveRep = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!repForm.name.trim()) {
      setRepFormError('Name is required.')
      return
    }
    setIsSavingRep(true)
    setRepFormError(null)
    const payload = {
      name: repForm.name.trim() || null,
      relationship: repForm.relationship.trim() || null,
      phone_number: repForm.phone_number.trim() || null,
      email_address: repForm.email_address.trim() || null,
    }
    try {
      const supabase = createClient()
      if (repModalMode === 'edit' && repModalEditingId) {
        const { error } = await q.updateRepresentative(supabase, repModalEditingId, payload)
        if (error) throw error
        setLocalRepresentatives((prev) =>
          prev.map((r) =>
            r.id === repModalEditingId
              ? { ...r, ...payload }
              : r
          )
        )
      } else {
        const { data: inserted, error } = await q.insertRepresentative(supabase, {
          patient_id: client.id,
          ...payload,
          display_order: repModalSlot,
        })
        if (error) throw error
        if (inserted) {
          setLocalRepresentatives((prev) =>
            [...prev, inserted].sort((a, b) => a.display_order - b.display_order)
          )
        }
      }
      setRepModalOpen(false)
      router.refresh()
    } catch (err: unknown) {
      setRepFormError(err instanceof Error ? err.message : 'Failed to save. Please try again.')
    } finally {
      setIsSavingRep(false)
    }
  }

  const handleClientChange = (clientId: string) => {
    if (clientId === client.id) return
    setIsClientSwitching(true)
    router.push(`/pages/agency/clients/${clientId}`)
  }

  const handlePrevious = () => {
    if (previousClient && previousClient.id !== client.id) {
      setIsClientSwitching(true)
      router.push(`/pages/agency/clients/${previousClient.id}`)
    }
  }

  const handleNext = () => {
    if (nextClient && nextClient.id !== client.id) {
      setIsClientSwitching(true)
      router.push(`/pages/agency/clients/${nextClient.id}`)
    }
  }

  const patientDocuments: PatientDocument[] = Array.isArray(localClient.documents) ? localClient.documents : []

  const handleDocumentFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length || !localClient.id) return
    const filesArray = Array.from(files)
    e.target.value = ''
    setDocumentUploadError(null)
    setIsUploadingDocument(true)
    try {
      const supabase = createClient()

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setDocumentUploadError('You must be logged in to upload documents')
        setIsUploadingDocument(false)
        return
      }

      const uploadedPaths: string[] = []
      const newDocs: PatientDocument[] = []

      for (let i = 0; i < filesArray.length; i++) {
        const file = filesArray[i]
        const docId = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 9)}`
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${localClient.id}/${docId}_${safeName}`

        const { error: uploadError } = await supabase.storage
          .from('patient-documents')
          .upload(path, file)

        if (uploadError) {
          if (uploadedPaths.length > 0) {
            await supabase.storage.from('patient-documents').remove(uploadedPaths)
          }
          throw uploadError
        }
        uploadedPaths.push(path)

        const { data: { publicUrl } } = supabase.storage
          .from('patient-documents')
          .getPublicUrl(path)

        newDocs.push({
          id: docId,
          name: file.name,
          path,
          url: publicUrl,
          uploaded_at: new Date().toISOString(),
          size: file.size,
        })
      }

      const nextDocs = [...patientDocuments, ...newDocs]
      const { error: updateError } = await updatePatientDocumentsAction(localClient.id, nextDocs)
      if (updateError) {
        if (uploadedPaths.length > 0) {
          await supabase.storage.from('patient-documents').remove(uploadedPaths)
        }
        throw new Error(updateError)
      }
      setLocalClient((c) => ({ ...c, documents: nextDocs }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message) : 'Upload failed'
      setDocumentUploadError(message)
    } finally {
      setIsUploadingDocument(false)
    }
  }

  const handleDeleteDocument = async (doc: PatientDocument) => {
    if (!localClient.id) return
    setIsDeletingDocId(doc.id)
    setDocumentUploadError(null)
    try {
      const supabase = createClient()
      await supabase.storage.from('patient-documents').remove([doc.path])
      const nextDocs = patientDocuments.filter((d) => d.id !== doc.id)
      const { error } = await updatePatientDocumentsAction(localClient.id, nextDocs)
      if (error) throw new Error(error)
      setLocalClient((c) => ({ ...c, documents: nextDocs }))
      setDocToDelete(null)
    } catch (err: unknown) {
      setDocumentUploadError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setIsDeletingDocId(null)
    }
  }

  const downloadPatientDocument = async (doc: PatientDocument) => {
    if (!doc.url) return
    setDownloadingDocId(doc.id)
    setDocumentUploadError(null)
    try {
      const res = await fetch(doc.url)
      if (!res.ok) throw new Error(`Download failed (${res.status})`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = sanitizeDownloadFilename(doc.name)
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
    } catch {
      try {
        window.open(doc.url, '_blank', 'noopener,noreferrer')
      } catch {
        setDocumentUploadError('Could not download this document. Try opening it in a new tab from your browser.')
      }
    } finally {
      setDownloadingDocId(null)
    }
  }

  const openCaregiverReqsModal = () => {
    setCaregiverReqsSelection([...caregiverRequirements])
    setCaregiverReqsSearch('')
    setCaregiverReqsDropdownOpen(null)
    setCaregiverReqsError(null)
    setCaregiverReqsModalOpen(true)
  }

  const closeCaregiverReqsModal = () => {
    if (!isSavingCaregiverReqs) {
      setCaregiverReqsModalOpen(false)
      setCaregiverReqsDropdownOpen(null)
      setCaregiverReqsError(null)
    }
  }

  const toggleCaregiverSkill = (name: string) => {
    setCaregiverReqsSelection((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]
    )
  }

  const setCategorySkillSelection = (skills: { type: string; name: string }[], shouldSelect: boolean) => {
    const names = skills.map((s) => s.name)
    setCaregiverReqsSelection((prev) => {
      if (shouldSelect) return Array.from(new Set([...prev, ...names]))
      const remove = new Set(names)
      return prev.filter((name) => !remove.has(name))
    })
  }

  const handleSaveCaregiverReqs = async () => {
    setIsSavingCaregiverReqs(true)
    setCaregiverReqsError(null)
    try {
      const supabase = createClient()
      const { error } = await q.upsertCaregiverRequirements(supabase, localClient.id, caregiverReqsSelection)
      if (error) throw error
      setCaregiverRequirements(caregiverReqsSelection)
      setCaregiverReqsModalOpen(false)
      router.refresh()
    } catch (err: unknown) {
      setCaregiverReqsError(err instanceof Error ? err.message : 'Failed to save requirements.')
    } finally {
      setIsSavingCaregiverReqs(false)
    }
  }

  const openReportIncidentModal = () => {
    const today = toLocalDateString(new Date())
    setIncidentForm({
      incident_date: today,
      reporting_date: today,
      primary_contact_person: '',
      description: '',
    })
    setIncidentFormFile(null)
    if (incidentFileInputRef.current) incidentFileInputRef.current.value = ''
    setIncidentFormError(null)
    setIncidentModalOpen(true)
  }

  const closeIncidentModal = () => {
    if (!isSavingIncident) {
      setIncidentModalOpen(false)
      setIncidentFormError(null)
    }
  }

  const ACCEPTED_INCIDENT_FILE_TYPES = '.pdf,.doc,.docx,.png,.jpg'

  const handleSaveIncident = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!incidentForm.incident_date.trim()) {
      setIncidentFormError('Incident date is required.')
      return
    }
    if (!incidentForm.reporting_date.trim()) {
      setIncidentFormError('Reporting date is required.')
      return
    }
    if (!incidentForm.primary_contact_person.trim()) {
      setIncidentFormError('Primary contact person is required.')
      return
    }
    if (!incidentForm.description.trim()) {
      setIncidentFormError('Description of incident is required.')
      return
    }
    if (!incidentFormFile) {
      setIncidentFormError('Please attach the incident report file.')
      return
    }
    setIsSavingIncident(true)
    setIncidentFormError(null)
    try {
      const supabase = createClient()
      const { data: inserted, error } = await q.insertIncident(supabase, {
        patient_id: localClient.id,
        incident_date: incidentForm.incident_date,
        reporting_date: incidentForm.reporting_date,
        primary_contact_person: incidentForm.primary_contact_person.trim(),
        description: incidentForm.description.trim(),
      })
      if (error) throw error
      if (!inserted) throw new Error('Insert failed')
      let file_path: string | null = null
      let file_name: string | null = null
      const safeName = incidentFormFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${localClient.id}/incidents/${inserted.id}_${safeName}`
      const { error: uploadError } = await supabase.storage
        .from('patient-documents')
        .upload(path, incidentFormFile)
      if (uploadError) {
        await q.deleteIncident(supabase, inserted.id)
        throw uploadError
      }
      file_path = path
      file_name = incidentFormFile.name
      const { data: updated, error: updateError } = await q.updateIncident(supabase, inserted.id, { file_path, file_name })
      if (updateError) throw updateError
      const row = updated ?? { ...inserted, file_path, file_name }
      setLocalIncidents((prev) => [row, ...prev])
      setIncidentModalOpen(false)
      router.refresh()
    } catch (err: unknown) {
      setIncidentFormError(err instanceof Error ? err.message : 'Failed to save incident.')
    } finally {
      setIsSavingIncident(false)
    }
  }

  const formatIncidentDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const formatIncidentUploadedAt = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const getIncidentFileUrl = (incident: PatientIncident) => {
    if (!incident.file_path) return null
    const supabase = createClient()
    const { data: { publicUrl } } = supabase.storage.from('patient-documents').getPublicUrl(incident.file_path)
    return publicUrl
  }

  const downloadIncidentFile = async (incident: PatientIncident) => {
    const url = getIncidentFileUrl(incident)
    if (!url) return
    const displayName = incident.file_name?.trim() || 'incident-report'
    setDownloadingIncidentId(incident.id)
    setIncidentListError(null)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Download failed (${res.status})`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = sanitizeDownloadFilename(displayName)
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
    } catch {
      try {
        window.open(url, '_blank', 'noopener,noreferrer')
      } catch {
        setIncidentListError('Could not download this file. Try again or open it in a new tab.')
      }
    } finally {
      setDownloadingIncidentId(null)
    }
  }

  const handleDeleteIncident = async (incident: PatientIncident) => {
    setDeletingIncidentId(incident.id)
    setIncidentListError(null)
    try {
      const supabase = createClient()
      const { error } = await q.deleteIncident(supabase, incident.id)
      if (error) throw error
      setLocalIncidents((prev) => prev.filter((i) => i.id !== incident.id))
      router.refresh()
    } catch (err: unknown) {
      setIncidentListError(err instanceof Error ? err.message : 'Failed to delete incident.')
    } finally {
      setDeletingIncidentId(null)
    }
  }

  const ADL_DAYS = [
    { label: 'Mon', value: 1 },
    { label: 'Tue', value: 2 },
    { label: 'Wed', value: 3 },
    { label: 'Thu', value: 4 },
    { label: 'Fri', value: 5 },
    { label: 'Sat', value: 6 },
    { label: 'Sun', value: 7 },
  ] as const
  const DAY_LABELS: Record<number, string> = {
    1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday',
    5: 'Friday', 6: 'Saturday', 7: 'Sunday',
  }
  /** Weekly visit repeat uses JS getDay(): 0=Sun … 6=Sat. Buttons shown Mo → Su. */
  const VISIT_WEEKLY_REPEAT_DAYS_ORDER = [
    { getDay: 1, label: 'Mo' },
    { getDay: 2, label: 'Tu' },
    { getDay: 3, label: 'We' },
    { getDay: 4, label: 'Th' },
    { getDay: 5, label: 'Fr' },
    { getDay: 6, label: 'Sa' },
    { getDay: 0, label: 'Su' },
  ] as const
  const getSchedule = (adlCode: string, dayOfWeek: number) =>
    localAdlSchedules.find((s) => s.adl_code === adlCode && s.day_of_week === dayOfWeek)
  const getAdlNote = (adlCode: string): string => {
    const row = localAdlSchedules.find((s) => s.adl_code === adlCode && (s.adl_note ?? '').trim() !== '')
      ?? localAdlSchedules.find((s) => s.adl_code === adlCode && s.day_of_week === 1)
    return (row?.adl_note ?? '').trim()
  }

  const openAddAdlModal = () => {
    setAddAdlSearch('')
    setAddAdlSelected(new Set())
    setAddAdlError(null)
    setAddAdlModalOpen(true)
  }
  const closeAddAdlModal = () => {
    if (!isSavingAddAdl) setAddAdlModalOpen(false)
  }
  const handleSaveAddAdl = async (e: React.FormEvent) => {
    e.preventDefault()
    const toAdd = Array.from(addAdlSelected).filter((name) => !localAdls.some((a) => a.adl_code === name))
    if (toAdd.length === 0) {
      setAddAdlModalOpen(false)
      return
    }
    setIsSavingAddAdl(true)
    setAddAdlError(null)
    try {
      const supabase = createClient()
      const nextOrder = localAdls.length > 0 ? Math.max(...localAdls.map((a) => a.display_order)) + 1 : 0
      const { data: inserted, error } = await q.insertAdls(supabase, localClient.id, toAdd, nextOrder)
      if (error) throw error
      if (inserted) setLocalAdls((prev) => [...prev, ...inserted])
      setAddAdlModalOpen(false)
      router.refresh()
    } catch (err: unknown) {
      setAddAdlError(err instanceof Error ? err.message : 'Failed to add ADLs.')
    } finally {
      setIsSavingAddAdl(false)
    }
  }

  const openSelectTimeModal = (adl: { name: string; group: string }, dayOfWeek: number, dayLabel: string) => {
    const existing = getSchedule(adl.name, dayOfWeek)
    setSelectTimeAdl(adl)
    setSelectTimeDay(dayOfWeek)
    setSelectTimeDayLabel(dayLabel)
    if (existing && existing.schedule_type === 'specific_times') {
      const slots = {
        morning: !!existing.slot_morning,
        afternoon: !!existing.slot_afternoon,
        evening: !!existing.slot_evening,
        night: !!existing.slot_night,
      }
      setSelectTimeForm({
        timesPerDay: Math.min(4, Math.max(1, existing.times_per_day ?? 1)) as 1 | 2 | 3 | 4,
        morning: slots.morning,
        afternoon: slots.afternoon,
        evening: slots.evening,
        night: slots.night,
        slotMorning: (existing.slot_morning === 'as_needed' ? 'as_needed' : 'always') as 'always' | 'as_needed',
        slotAfternoon: (existing.slot_afternoon === 'as_needed' ? 'as_needed' : 'always') as 'always' | 'as_needed',
        slotEvening: (existing.slot_evening === 'as_needed' ? 'as_needed' : 'always') as 'always' | 'as_needed',
        slotNight: (existing.slot_night === 'as_needed' ? 'as_needed' : 'always') as 'always' | 'as_needed',
      })
    } else {
      setSelectTimeForm({
        timesPerDay: 1,
        morning: false,
        afternoon: false,
        evening: false,
        night: false,
        slotMorning: 'always',
        slotAfternoon: 'always',
        slotEvening: 'always',
        slotNight: 'always',
      })
    }
    setSelectTimeModalOpen(true)
  }
  const closeSelectTimeModal = () => {
    setSelectTimeModalOpen(false)
  }
  const openAdlNoteModal = (adl: { name: string; group: string }) => {
    setAdlNoteTarget(adl)
    setAdlNoteDraft(getAdlNote(adl.name))
    setAdlNoteModalOpen(true)
  }
  const closeAdlNoteModal = () => {
    setAdlNoteModalOpen(false)
    setAdlNoteTarget(null)
  }
  const applyAdlNoteToLocalSchedule = (adlCode: string, note: string) => {
    const normalized = note.trim()
    const now = new Date().toISOString()
    setLocalAdlSchedules((prev) => {
      const forAdl = prev.filter((s) => s.adl_code === adlCode)
      if (forAdl.length === 0) return prev
      return prev.map((s) =>
        s.adl_code !== adlCode
          ? s
          : {
              ...s,
              adl_note: normalized || null,
              updated_at: now,
            }
      )
    })
    setAdlNoteModalOpen(false)
    setAdlNoteTarget(null)
  }
  const handleSaveAdlNote = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adlNoteTarget) return
    // applyAdlNoteToLocalSchedule(adlNoteTarget.name, adlNoteDraft)
    const id = localAdlSchedules.find((s) => s.adl_code === adlNoteTarget.name && s.day_of_week === selectTimeDay)?.id ?? ''
    
    applyAdlNoteToLocalSchedule(adlNoteTarget.name, adlNoteDraft)
    if (id === '') return
    const supabase = createClient()
    const { error } = await q.updatePatientAdlDaySchedule(supabase, {
      id,
      adl_note: adlNoteDraft,
    })

  }
  const handleRemoveAdlNote = () => {
    if (!adlNoteTarget) return
    applyAdlNoteToLocalSchedule(adlNoteTarget.name, '')
  }
  /** Updates local ADL day schedule only; DB is updated on Save ADL Plan. */
  const applySelectTimeSchedule = (
    scheduleType: 'never' | 'always' | 'as_needed' | 'specific_times',
    payload?: {
      times_per_day?: number
      slot_morning?: string | null
      slot_afternoon?: string | null
      slot_evening?: string | null
      slot_night?: string | null
    }
  ) => {
    if (!selectTimeAdl) return
    const existing = localAdlSchedules.find(
      (s) => s.adl_code === selectTimeAdl.name && s.day_of_week === selectTimeDay
    )
    const now = new Date().toISOString()
    const base = {
      id: existing?.id ?? `temp-${selectTimeAdl.name}-${selectTimeDay}`,
      patient_id: localClient.id,
      adl_code: selectTimeAdl.name,
      day_of_week: selectTimeDay,
      adl_note: existing?.adl_note ?? null,
      display_order: existing?.display_order ?? 0,
      created_at: existing?.created_at || now,
      updated_at: now,
    }
    let row: PatientAdlDaySchedule
    if (scheduleType === 'specific_times' && payload) {
      row = {
        ...base,
        schedule_type: 'specific_times',
        times_per_day: payload.times_per_day ?? null,
        slot_morning: payload.slot_morning ?? null,
        slot_afternoon: payload.slot_afternoon ?? null,
        slot_evening: payload.slot_evening ?? null,
        slot_night: payload.slot_night ?? null,
      }
    } else {
      row = {
        ...base,
        schedule_type: scheduleType,
        times_per_day: null,
        slot_morning: null,
        slot_afternoon: null,
        slot_evening: null,
        slot_night: null,
      }
    }
    setLocalAdlSchedules((prev) => {
      const rest = prev.filter((s) => !(s.adl_code === selectTimeAdl.name && s.day_of_week === selectTimeDay))
      return [...rest, row]
    })
    setSelectTimeModalOpen(false)
  }

  const handleDoneSelectTime = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectTimeAdl) return
    const hasSlots = selectTimeForm.morning || selectTimeForm.afternoon || selectTimeForm.evening || selectTimeForm.night
    const scheduleType = hasSlots ? 'specific_times' : 'never'
    applySelectTimeSchedule(
      scheduleType,
      hasSlots
        ? {
            times_per_day: selectTimeForm.timesPerDay,
            slot_morning: selectTimeForm.morning ? selectTimeForm.slotMorning : null,
            slot_afternoon: selectTimeForm.afternoon ? selectTimeForm.slotAfternoon : null,
            slot_evening: selectTimeForm.evening ? selectTimeForm.slotEvening : null,
            slot_night: selectTimeForm.night ? selectTimeForm.slotNight : null,
          }
        : undefined
    )
  }

  const handleSelectTimeQuick = (scheduleType: 'always' | 'as_needed' | 'never') => {
    applySelectTimeSchedule(scheduleType)
  }

  const handleDeleteAdl = async (adlCode: string) => {
    setDeletingAdlCode(adlCode)
    setAdlPlanError(null)
    try {
      const supabase = createClient()
      const { error } = await q.deleteAdl(supabase, localClient.id, adlCode)
      if (error) throw error
      setLocalAdls((prev) => prev.filter((a) => a.adl_code !== adlCode))
      setLocalAdlSchedules((prev) => prev.filter((s) => s.adl_code !== adlCode))
      setAdlToDelete(null)
      router.refresh()
    } catch (err: unknown) {
      setAdlPlanError(err instanceof Error ? err.message : 'Failed to remove ADL.')
    } finally {
      setDeletingAdlCode(null)
    }
  }

  const handleAttemptRemoveAdlFromPlan = async (adlCode: string) => {
    setAdlPlanError(null)
    try {
      const supabase = createClient()
      const { data: schedules, error } = await q.getSchedulesByPatientId(supabase, localClient.id)
      if (error) throw error
      const scheduleRows = (schedules ?? []) as ScheduleRow[]
      const isUsedInSchedules = scheduleRows.some((s: ScheduleRow) =>
        (s.adl_codes ?? []).some((token: string) => token === adlCode || token.endsWith(`::${adlCode}`))
      )
      if (isUsedInSchedules) {
        setAdlPlanError('This ADL is already used in scheduled visits. Remove it from Schedule first before deleting from ADL plan.')
        return
      }
      setPendingAdlDeletes((prev) => (prev.includes(adlCode) ? prev : [...prev, adlCode]))
      setLocalAdls((prev) => prev.filter((a) => a.adl_code !== adlCode))
      setLocalAdlSchedules((prev) => prev.filter((s) => s.adl_code !== adlCode))
    } catch (err: unknown) {
      setAdlPlanError(err instanceof Error ? err.message : 'Failed to validate ADL usage in schedules.')
    }
  }

  const handleSaveAdlPlan = async () => {
    setIsSavingAdlPlan(true)
    setAdlPlanError(null)
    try {
      const supabase = createClient()
      for (const adlCode of pendingAdlDeletes) {
        const { error } = await q.deleteAdl(supabase, localClient.id, adlCode)
        if (error) throw error
      }
      setPendingAdlDeletes([])
      for (const s of localAdlSchedules) {
        await q.upsertPatientAdlDaySchedule(supabase, {
          patient_id: s.patient_id,
          adl_code: s.adl_code,
          day_of_week: s.day_of_week,
          // adl_note: s.adl_note,
          schedule_type: s.schedule_type,
          times_per_day: s.times_per_day,
          slot_morning: s.slot_morning,
          slot_afternoon: s.slot_afternoon,
          slot_evening: s.slot_evening,
          slot_night: s.slot_night,
        })
      }
      router.refresh()
    } catch (err: unknown) {
      setAdlPlanError(err instanceof Error ? err.message : 'Failed to save ADL plan.')
    } finally {
      setIsSavingAdlPlan(false)
    }
  }

  const hasAdlPlanChanges = useMemo(() => {
    const initAdls = initialAdls ?? []
    const initSched = initialAdlSchedules ?? []
    const sortAdl = (a: PatientAdl, b: PatientAdl) => a.adl_code.localeCompare(b.adl_code)
    const localAdlSig = [...localAdls].sort(sortAdl).map((a) => ({ c: a.adl_code, o: a.display_order }))
    const initAdlSig = [...initAdls].sort(sortAdl).map((a) => ({ c: a.adl_code, o: a.display_order }))
    if (JSON.stringify(localAdlSig) !== JSON.stringify(initAdlSig)) return true
    const schedKey = (s: PatientAdlDaySchedule) => ({
      adl_code: s.adl_code,
      day_of_week: s.day_of_week,
      schedule_type: s.schedule_type,
      times_per_day: s.times_per_day,
      slot_morning: s.slot_morning,
      slot_afternoon: s.slot_afternoon,
      slot_evening: s.slot_evening,
      slot_night: s.slot_night,
      // adl_note: s.adl_note,
      display_order: s.display_order,
    })
    const sortSched = (a: PatientAdlDaySchedule, b: PatientAdlDaySchedule) =>
      a.adl_code.localeCompare(b.adl_code) || a.day_of_week - b.day_of_week
    const localSchedSig = [...localAdlSchedules].sort(sortSched).map(schedKey)
    const initSchedSig = [...initSched].sort(sortSched).map(schedKey)
    return JSON.stringify(localSchedSig) !== JSON.stringify(initSchedSig)
  }, [localAdls, localAdlSchedules, initialAdls, initialAdlSchedules])

  const formatAdlDaySummary = (schedule: PatientAdlDaySchedule | undefined): string | null => {
    if (!schedule || schedule.schedule_type === 'never') return null
    if (schedule.schedule_type === 'always') return 'Always'
    if (schedule.schedule_type === 'as_needed') return 'As Needed'
    return null
  }

  const getSpecificTimesSlots = (schedule: PatientAdlDaySchedule | undefined): { labels: string[]; timesPerDay: number } | null => {
    if (!schedule || schedule.schedule_type !== 'specific_times') return null
    const labels: string[] = []
    if (schedule.slot_morning) labels.push('Morning')
    if (schedule.slot_afternoon) labels.push('Afternoon')
    if (schedule.slot_evening) labels.push('Evening')
    if (schedule.slot_night) labels.push('Night')
    if (labels.length === 0) return null
    return { labels, timesPerDay: schedule.times_per_day ?? 1 }
  }

  const isAdlRowAllSelected = (adlCode: string) => {
    return [1, 2, 3, 4, 5, 6, 7].every((dow) => {
      const s = localAdlSchedules.find((x) => x.adl_code === adlCode && x.day_of_week === dow)
      return s && s.schedule_type === 'specific_times' && s.times_per_day === 1 && s.slot_morning
    })
  }

  const handleToggleAdlRowAll = (adlRow: { adl_code: string; display_order?: number }) => {
    const existingForAdl = localAdlSchedules.filter((s) => s.adl_code === adlRow.adl_code)
    const isAllSelected = isAdlRowAllSelected(adlRow.adl_code)
    const displayOrder = existingForAdl[0]?.display_order ?? adlRow.display_order ?? 0
    const rest = localAdlSchedules.filter((s) => s.adl_code !== adlRow.adl_code)
    const newEntries: PatientAdlDaySchedule[] = []
    for (let dow = 1; dow <= 7; dow++) {
      const existing = existingForAdl.find((x) => x.day_of_week === dow)
      const base = {
        id: existing?.id ?? `temp-${adlRow.adl_code}-${dow}`,
        patient_id: localClient.id,
        adl_code: adlRow.adl_code,
        day_of_week: dow,
        adl_note: existing?.adl_note ?? null,
        display_order: displayOrder,
        created_at: existing?.created_at ?? '',
        updated_at: existing?.updated_at ?? '',
      } as const
      if (isAllSelected) {
        newEntries.push({
          ...base,
          schedule_type: 'never',
          times_per_day: null,
          slot_morning: null,
          slot_afternoon: null,
          slot_evening: null,
          slot_night: null,
        })
      } else {
        newEntries.push({
          ...base,
          schedule_type: 'specific_times',
          times_per_day: 1,
          slot_morning: 'always',
          slot_afternoon: null,
          slot_evening: null,
          slot_night: null,
        })
      }
    }
    setLocalAdlSchedules([...rest, ...newEntries])
  }

  const formatWeekRangeLabel = (start: Date, end: Date) => {
    const m1 = start.toLocaleString('en-US', { month: 'short' })
    const m2 = end.toLocaleString('en-US', { month: 'short' })
    const y = start.getFullYear()
    return `${m1} ${start.getDate()} - ${m2} ${end.getDate()}, ${y}`
  }

  const MONTHLY_ORDINAL_LABELS = ['first', 'second', 'third', 'fourth', 'last'] as const
  const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  const getOrdinalAndWeekdayFromDate = (dateStr: string): { ordinal: 1 | 2 | 3 | 4 | 5; weekday: number } => {
    const d = new Date(dateStr + 'T12:00:00')
    const weekday = d.getDay()
    const year = d.getFullYear()
    const month = d.getMonth()
    const dayOfMonth = d.getDate()
    const sameWeekdayDates: number[] = []
    const lastDay = new Date(year, month + 1, 0).getDate()
    for (let date = 1; date <= lastDay; date++) {
      if (new Date(year, month, date).getDay() === weekday) sameWeekdayDates.push(date)
    }
    const occurrenceIndex = sameWeekdayDates.indexOf(dayOfMonth) + 1
    const isLast = occurrenceIndex === sameWeekdayDates.length && sameWeekdayDates.length >= 1
    const ordinal = isLast ? 5 : (Math.min(occurrenceIndex, 4) as 1 | 2 | 3 | 4)
    return { ordinal, weekday }
  }

  const getMonthlyRepeatLabel = (ordinal: number, weekday: number) =>
    ordinal === 0
      ? `Monthly on every ${WEEKDAY_NAMES[weekday]}`
      : `Monthly on the ${MONTHLY_ORDINAL_LABELS[(ordinal as 1 | 2 | 3 | 4 | 5) - 1]} ${WEEKDAY_NAMES[weekday]}`

  const datesBetween = (startStr: string, endStr: string): string[] => {
    const out: string[] = []
    const start = new Date(startStr + 'T12:00:00')
    const end = new Date(endStr + 'T12:00:00')
    const d = new Date(start)
    while (d <= end && out.length < 365) {
      out.push(toLocalDateString(d))
      d.setDate(d.getDate() + 1)
    }
    return out
  }

  const datesWeeklyBetween = (startStr: string, endStr: string, daysOfWeek: number[]): string[] => {
    const set = new Set(daysOfWeek)
    return datesBetween(startStr, endStr).filter((dateStr) => {
      const d = new Date(dateStr + 'T12:00:00')
      return set.has(d.getDay())
    })
  }

  const getOrdinalWeekdayInMonth = (year: number, month: number, ordinal: 1 | 2 | 3 | 4 | 5, weekday: number): string | null => {
    const lastDay = new Date(year, month + 1, 0).getDate()
    const sameWeekdayDates: number[] = []
    for (let date = 1; date <= lastDay; date++) {
      if (new Date(year, month, date).getDay() === weekday) sameWeekdayDates.push(date)
    }
    if (sameWeekdayDates.length === 0) return null
    const index = ordinal === 5 ? sameWeekdayDates.length - 1 : Math.min(ordinal - 1, sameWeekdayDates.length - 1)
    const day = sameWeekdayDates[index]
    const y = year
    const m = String(month + 1).padStart(2, '0')
    const dd = String(day).padStart(2, '0')
    return `${y}-${m}-${dd}`
  }

  const getAllWeekdayDatesInMonth = (year: number, month: number, weekday: number): string[] => {
    const lastDay = new Date(year, month + 1, 0).getDate()
    const out: string[] = []
    for (let date = 1; date <= lastDay; date++) {
      if (new Date(year, month, date).getDay() === weekday) {
        const m = String(month + 1).padStart(2, '0')
        const dd = String(date).padStart(2, '0')
        out.push(`${year}-${m}-${dd}`)
      }
    }
    return out
  }

  const datesMonthlyBetween = (startStr: string, endStr: string, ordinal: number, weekday: number): string[] => {
    const out: string[] = []
    const start = new Date(startStr + 'T12:00:00')
    const end = new Date(endStr + 'T12:00:00')
    let y = start.getFullYear()
    let m = start.getMonth()
    const wd = Math.min(6, Math.max(0, weekday))
    while (out.length < 365) {
      if (ordinal === 0) {
        for (const dateStr of getAllWeekdayDatesInMonth(y, m, wd)) {
          const d = new Date(dateStr + 'T12:00:00')
          if (d >= start && d <= end) out.push(dateStr)
        }
      } else {
        const ord = Math.min(5, Math.max(1, ordinal)) as 1 | 2 | 3 | 4 | 5
        const dateStr = getOrdinalWeekdayInMonth(y, m, ord, wd)
        if (dateStr) {
          const d = new Date(dateStr + 'T12:00:00')
          if (d >= start && d <= end) out.push(dateStr)
        }
      }
      m += 1
      if (m > 11) {
        m = 0
        y += 1
      }
      if (y > end.getFullYear() || (y === end.getFullYear() && m > end.getMonth())) break
    }
    return out
  }

  const datesMonthlyBetweenFromRules = (
    startStr: string,
    endStr: string,
    rules: { ordinal: number; weekday: number }[]
  ): string[] => {
    const set = new Set<string>()
    for (const r of rules) {
      const ord = r.ordinal
      const wd = Math.min(6, Math.max(0, r.weekday))
      for (const d of datesMonthlyBetween(startStr, endStr, ord, wd)) set.add(d)
    }
    return Array.from(set).sort()
  }

  const getSundayFromMonday = (monday: Date): Date => {
    const d = new Date(monday)
    d.setDate(d.getDate() + 6)
    return d
  }

  const DAY_LABELS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const getWeekDates = () => {
    const dates: Date[] = []
    const d = new Date(scheduleWeekStart)
    for (let i = 0; i < 7; i++) {
      dates.push(new Date(d))
      d.setDate(d.getDate() + 1)
    }
    return dates
  }

  const getDayOfWeekDb = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00').getDay()
    return d === 0 ? 7 : d
  }

  const getDueAdlCountForDay = (dateStr: string) => {
    const dayOfWeekDb = getDayOfWeekDb(dateStr)
    let count = 0
    for (const a of localAdls) {
      const s = localAdlSchedules.find((x) => x.adl_code === a.adl_code && x.day_of_week === dayOfWeekDb)
      if (s && s.schedule_type !== 'never') count += 1
    }
    return count
  }

  const getUnassignedAdlCountForDay = (dateStr: string) => {
    const dayOfWeekDb = getDayOfWeekDb(dateStr)
    // Expected slots = sum over ADLs scheduled this day of (morning + afternoon + evening + night slots)
    let expectedSlots = 0
    for (const a of localAdls) {
      const s = localAdlSchedules.find((x) => x.adl_code === a.adl_code && x.day_of_week === dayOfWeekDb)
      if (!s || s.schedule_type === 'never') continue
      if (s.schedule_type === 'always' || s.schedule_type === 'as_needed') {
        expectedSlots += 1
        continue
      }
      expectedSlots += [s.slot_morning, s.slot_afternoon, s.slot_evening, s.slot_night].filter(Boolean).length
    }
    // Assigned slots = each schedule row on this date counts one slot per adl_code in it
    const assignedSlots = weekSchedules
      .filter((s) => s.date === dateStr && s.adl_codes?.length)
      .reduce((sum, s) => sum + (s.adl_codes as string[]).length, 0)
    return Math.max(0, expectedSlots - assignedSlots)
  }

  /** Add/Edit Visit modal — ADLs tab: selections are per (time slot × ADL), stored as `slotKey::adlCode` in visitAdlSelected. */
  const renderVisitAdlSelectionList = (dayOfWeekDb: number | null, assignedSlots: Set<string>) => {
    const dow = dayOfWeekDb ?? 1
    const candidates = localAdls.filter((a) => {
      if (!dayOfWeekDb) return true
      const s = localAdlSchedules.find((x) => x.adl_code === a.adl_code && x.day_of_week === dayOfWeekDb)
      return !!(s && s.schedule_type !== 'never')
    })

    const rowEntries: Array<{ adl: PatientAdl; rowKey: string; periodLabel: string; storageSlot: string; groupName: string }> = []
    for (const a of candidates) {
      const s = localAdlSchedules.find((x) => x.adl_code === a.adl_code && x.day_of_week === dow)
      const info = ADL_LISTS.find((x) => x.name === a.adl_code)
      const groupName = info?.group ?? 'General'
      if (s?.schedule_type === 'always') {
        const token = encodeVisitAdlSlotKey('any', a.adl_code)
        if (!assignedSlots.has(token)) {
          rowEntries.push({ adl: a, rowKey: `always-${a.adl_code}`, periodLabel: 'Any time', storageSlot: 'any', groupName })
        }
      } else if (s?.schedule_type === 'as_needed') {
        const token = encodeVisitAdlSlotKey('as_needed', a.adl_code)
        if (!assignedSlots.has(token)) {
          rowEntries.push({ adl: a, rowKey: `needed-${a.adl_code}`, periodLabel: 'As needed', storageSlot: 'as_needed', groupName })
        }
      } else if (s?.schedule_type === 'specific_times') {
        for (const { key, label } of ADL_VISIT_TIME_SLOTS) {
          if (!scheduleHasAdlSlot(s, key)) continue
          const token = encodeVisitAdlSlotKey(key, a.adl_code)
          if (assignedSlots.has(token)) continue
          rowEntries.push({ adl: a, rowKey: `${key}-${a.adl_code}`, periodLabel: label, storageSlot: key, groupName })
        }
      }
    }

    const periodBadgeClass =
      'inline-flex items-center gap-0.5 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 border border-gray-200/80'

    const renderRow = (a: PatientAdl, rowKey: string, periodBadges: string[], storageSlot: string) => {
      const info = ADL_LISTS.find((x) => x.name === a.adl_code) ?? { name: a.adl_code, group: 'General' }
      const token = encodeVisitAdlSlotKey(storageSlot, a.adl_code)
      const isChecked = visitAdlSelected.has(token)
      return (
        <label
          key={rowKey}
          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${isChecked ? 'border-green-500 bg-green-50/50' : 'border-gray-200 hover:bg-gray-50'}`}
        >
          <input
            type="checkbox"
            checked={isChecked}
            onChange={(e) => {
              setVisitAdlSelected((prev) => {
                const next = new Set(prev)
                if (e.target.checked) next.add(token)
                else next.delete(token)
                return next
              })
            }}
            className="mt-1 rounded border-gray-300"
          />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-gray-900">{info.name}</div>
            <div className="text-xs text-gray-500 mt-0.5">{info.group}</div>
            <div className="flex flex-wrap gap-1 mt-1.5 items-center">
              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs text-gray-600 border border-gray-100 ${info.group === 'ADL' ? 'bg-blue-500 text-white' : 'bg-red-500 text-white'}`}>
                {info.group}
              </span>
              {periodBadges.map((b) => (
                <span key={b} className={periodBadgeClass}>
                  <Clock className="w-3 h-3 shrink-0 opacity-70" aria-hidden />
                  {b}
                </span>
              ))}
            </div>
          </div>
        </label>
      )
    }

    if (rowEntries.length === 0) {
      return (
        <p className="text-sm text-gray-500 py-4 text-center">
          No ADLs available for this day of the week. Add ADLs in the ADLs tab and set them for this day, or all are already assigned to visits on this date.
        </p>
      )
    }

    return (
      <div className="space-y-4">
        {(() => {
          const grouped = rowEntries.reduce<Record<string, typeof rowEntries>>((acc, item) => {
            if (!acc[item.groupName]) acc[item.groupName] = []
            acc[item.groupName].push(item)
            return acc
          }, {})
          const groupOrder = ['ADL', 'IADL']
          const groups = Object.keys(grouped).sort((a, b) => {
            const ai = groupOrder.indexOf(a.toUpperCase())
            const bi = groupOrder.indexOf(b.toUpperCase())
            if (ai === -1 && bi === -1) return a.localeCompare(b)
            if (ai === -1) return 1
            if (bi === -1) return -1
            return ai - bi
          })
          return groups.map((groupName) => (
            <div key={groupName}>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{groupName}</h4>
              <div className="space-y-2">
                {grouped[groupName].map((item) => renderRow(item.adl, item.rowKey, [item.periodLabel], item.storageSlot))}
              </div>
            </div>
          ))
        })()}
      </div>
    )
  }

  /** Pill segmented control for Details / ADLs in visit modals (matches design: grey track, white active segment). */
  const visitModalHeaderTabs = (
    <div className="flex w-full rounded-full bg-gray-100 p-1 gap-0.5">
      <button
        type="button"
        onClick={() => setAddVisitTab('details')}
        className={`flex-1 rounded-full py-2.5 text-sm font-medium transition-all ${
          addVisitTab === 'details'
            ? 'bg-white text-gray-900 border border-gray-200 shadow-sm'
            : 'text-gray-600 hover:text-gray-800'
        }`}
      >
        Details
      </button>
      <button
        type="button"
        onClick={() => setAddVisitTab('adls')}
        className={`flex-1 rounded-full py-2.5 text-sm font-medium transition-all inline-flex items-center justify-center gap-1.5 ${
          addVisitTab === 'adls'
            ? 'bg-white text-gray-900 border border-gray-200 shadow-sm'
            : 'text-gray-600 hover:text-gray-800'
        }`}
      >
        ADLs & IADLs
        {visitAdlSelected.size > 0 && (
          <span className="rounded-full bg-green-100 text-green-800 text-xs px-1.5 py-0.5 font-semibold tabular-nums">
            {visitAdlSelected.size}
          </span>
        )}
      </button>
    </div>
  )

  type CaregiverAvailabilityStatus = 'available' | 'booked' | 'blocked'

  const parseTimeToMinutes = (t: string) => {
    const [h, m] = (t ?? '0:0').split(':').map(Number)
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null
    return h * 60 + m
  }

  /** US ZIP: first 5 digits for `zipcodes` lookup (strips ZIP+4). */
  const normalizeUsZipForLookup = (zip: unknown): string | null => {
    if (zip === null || zip === undefined) return null
    const s = String(zip).trim()
    if (!s) return null
    const digits = s.replace(/\D/g, '')
    if (digits.length < 5) return null
    return digits.slice(0, 5)
  }

  const formatDistanceMiles = (miles: number) => {
    if (!Number.isFinite(miles)) return '—'
    if (miles === 0) return '0 mi'
    return `${miles} mi`
  }

  const caregiverOptions = useMemo(() => {
    const staff = staffList ?? []
    const requiredSkills = caregiverRequirements ?? []

    const clientZip = normalizeUsZipForLookup(localClient.zip_code)

    const startMins = parseTimeToMinutes(visitForm.startTime)
    const endMins = parseTimeToMinutes(visitForm.endTime)
    const hasTime = startMins !== null && endMins !== null && (endMins as number) > (startMins as number)
    const excludedScheduleId = editingSchedule?.id ?? null

    const options = staff.map((s) => {
      const caregiverSkills = Array.isArray((s as any).skills) ? ((s as any).skills as string[]) : []

      const requiredLen = requiredSkills.length
      const matchCount = requiredLen === 0 ? 0 : requiredSkills.filter((sk) => caregiverSkills.includes(sk)).length
      const skillMatchScore = requiredLen === 0 ? 1 : matchCount / requiredLen
      const blocked: boolean = requiredLen === 0 ? false : matchCount < requiredLen

      let booked = false
      if (hasTime) {
        booked = (visitDateSchedules ?? [])
          .filter((v) => v.id !== excludedScheduleId)
          .some((v) => {
            if (!v.caregiver_id) return false
            if (v.caregiver_id !== s.id) return false
            const vStart = parseTimeToMinutes(v.start_time ?? '0:00')
            const vEnd = parseTimeToMinutes(v.end_time ?? '0:00')
            if (vStart === null || vEnd === null) return false
            const aStart = startMins as number
            const aEnd = endMins as number
            return aStart < vEnd && aEnd > vStart
          })
      }

      const staffZip = normalizeUsZipForLookup((s as any).zip_code ?? (s as any).zipCode)
      let distanceMiles: number
      let distanceLabel: string
      // console.log("clientZip: ",clientZip)
      // console.log("staffZip: ",staffZip)
      if (clientZip && staffZip) {
        const d = zipcodes.distance(clientZip, staffZip)
        if (d != null && Number.isFinite(d)) {
          distanceMiles = d
          distanceLabel = formatDistanceMiles(d)
        } else {
          distanceMiles = Number.POSITIVE_INFINITY
          distanceLabel = '—'
        }
      } else {
        distanceMiles = Number.POSITIVE_INFINITY
        distanceLabel = '—'
      }

      const status: CaregiverAvailabilityStatus = blocked ? 'blocked' : booked ? 'booked' : 'available'

      return {
        caregiver: s,
        status,
        distanceMiles,
        distanceLabel,
        skillMatchScore,
      }
    })

    options.sort((a, b) => {
      // Closest first, then best skill match.
      if (a.distanceMiles !== b.distanceMiles) return a.distanceMiles - b.distanceMiles
      return b.skillMatchScore - a.skillMatchScore
    })

    return options
  }, [
    staffList,
    caregiverRequirements,
    localClient.zip_code,
    visitForm.startTime,
    visitForm.endTime,
    visitDateSchedules,
    editingSchedule?.id,
  ])

  const renderCaregiverPicker = () => {
    const selected = caregiverOptions.find((o) => o.caregiver.id === visitForm.caregiverId) ?? null
    const selectedName = selected
      ? `${selected.caregiver.first_name ?? ''} ${selected.caregiver.last_name ?? ''}`.trim()
      : ''

    const filtered = caregiverOptions.filter((o) => (caregiverPickerFilter === 'all' ? true : o.status === caregiverPickerFilter))

    const pillForStatus = (status: CaregiverAvailabilityStatus) => {
      if (status === 'available') {
        return (
          <span className="inline-flex items-center gap-1 border border-green-200 bg-green-50 text-green-700 rounded-md px-2 py-0.5 text-xs font-semibold">
            <Check className="w-3 h-3" />
            Available
          </span>
        )
      }
      if (status === 'booked') {
        return (
          <span className="inline-flex items-center gap-1 border border-amber-200 bg-amber-50 text-amber-700 rounded-md px-2 py-0.5 text-xs font-semibold">
            <Clock className="w-3 h-3" />
            Booked
          </span>
        )
      }
      return (
        <span className="inline-flex items-center gap-1 border border-red-200 bg-red-50 text-red-700 rounded-md px-2 py-0.5 text-xs font-semibold">
          <X className="w-3 h-3" />
          Blocked
        </span>
      )
    }

    const menuPanel = (
      <div
        ref={caregiverPickerDropdownRef}
        className="fixed z-[10050] bg-white border border-gray-200 rounded-xl shadow-lg overflow-x-hidden"
        style={
          caregiverPickerMenuFixed
            ? {
                left: caregiverPickerMenuFixed.left,
                bottom: caregiverPickerMenuFixed.bottom,
                width: caregiverPickerMenuFixed.width,
              }
            : undefined
        }
      >
        <div className="px-4 py-2 border-b border-gray-100 bg-white">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">SORTED BY: CLOSEST - BEST SKILL MATCH</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
            <button
              type="button"
              className={`inline-flex items-center gap-2 border-0 bg-transparent p-0 ${
                caregiverPickerFilter === 'available' ? 'font-semibold text-green-700' : 'text-green-700'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-green-500" />
              Available
            </button>
            <span className="text-gray-300">|</span>
            <button
              type="button"
              className={`inline-flex items-center gap-2 border-0 bg-transparent p-0 ${
                caregiverPickerFilter === 'booked' ? 'font-semibold text-amber-700' : 'text-amber-700'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              Booked
            </button>
            <span className="text-gray-300">|</span>
            <button
              type="button"
              className={`inline-flex items-center gap-2 border-0 bg-transparent p-0 ${
                caregiverPickerFilter === 'blocked' ? 'font-semibold text-red-700' : 'text-red-700'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-red-500" />
              Not Available
            </button>
          </div>
        </div>

        <div className="max-h-[240px] overflow-y-auto overflow-x-hidden">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-500">No caregivers found.</div>
          ) : (
            filtered.map((o, idx) => {
              const c = o.caregiver
              const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()
              const role = String((c as any).role ?? '')
              const phone = String((c as any).phone ?? '')
              const isBest = idx === 0

              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setVisitForm((p) => ({ ...p, caregiverId: c.id }))
                    setCaregiverPickerOpen(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setVisitForm((p) => ({ ...p, caregiverId: c.id }))
                      setCaregiverPickerOpen(false)
                    }
                  }}
                  className={`w-full px-4 py-2 border-b border-gray-50 hover:bg-gray-50 text-left cursor-pointer ${visitForm.caregiverId === c.id ? 'bg-blue-50/60' : 'bg-white'}`}
                >
                  <div className="flex items-start justify-between gap-4 min-w-0">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div
                        className={`w-6 h-6 rounded-full border flex items-center justify-center text-[12px] font-semibold flex-shrink-0 ${
                          isBest ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-200 text-gray-500'
                        }`}
                      >
                        {idx + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="text-sm font-semibold text-gray-900 truncate">{name}</div>
                          {isBest && (
                            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 flex-shrink-0">
                              Best
                            </span>
                          )}
                          <Link
                            href={`/pages/agency/caregiver/${c.id}?clientId=${localClient.id}&embed=1`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex shrink-0 text-gray-400 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                            aria-label="Open caregiver profile in new tab"
                            onClick={(e) => {
                              e.stopPropagation()
                              setCaregiverPickerOpen(false)
                            }}
                          >
                            <SquareArrowOutUpRight className="w-4 h-4" aria-hidden />
                          </Link>
                        </div>
                        {role ? <div className="text-[11px] text-gray-500 mt-0.5 truncate">{role}</div> : null}
                        {phone ? (
                          <div className="flex items-center gap-1 text-[11px] text-gray-500 mt-1 truncate">
                            <Phone className="w-3 h-3 text-gray-400 shrink-0" />
                            <span className="truncate">{phone}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {pillForStatus('available')}
                      <div className="flex items-center gap-1 text-[12px] text-gray-500 mt-2 justify-end whitespace-nowrap">
                        <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
                        <span>{o.distanceLabel}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    )

    return (
      <div ref={caregiverPickerWrapRef} className="relative">
        <button
          ref={caregiverPickerTriggerRef}
          type="button"
          onClick={() => setCaregiverPickerOpen((p) => !p)}
          className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-500"
          disabled={isSavingVisit}
        >
          <span className="block truncate" style={{ textAlign: 'left'}}>{selectedName || 'Select caregiver...'}</span>
        </button>

        {caregiverPickerOpen &&
          caregiverPickerMenuFixed &&
          typeof document !== 'undefined' &&
          createPortal(menuPanel, document.body)}
      </div>
    )
  }

  const getScheduleBlockColors = (type: string | null): { bg: string; border: string; text: string } => {
    const t = (type ?? 'Routine').toLowerCase()
    if (t === 'therapy') return { bg: '#f3e8ff', border: '#ad46ff', text: '#996cbb' }
    if (t === 'medical') return { bg: '#ffe2e2', border: '#fb2c36', text: '#c28082' }
    if (t === 'social') return { bg: '#fef9c2', border: '#f0b100', text: '#966d38' }
    if (t === 'other') return { bg: '#f3f4f6', border: '#6a7282', text: '#858a93' }
    return { bg: '#dbfce7', border: '#00c950', text: '#417e5a' }
  }

  const openAddVisitModal = () => {
    const today = toLocalDateString(new Date())
    setCaregiverPickerOpen(false)
    setCaregiverPickerFilter('all')
    setVisitForm({
      date: today,
      startTime: '09:00',
      endTime: '10:00',
      description: '',
      type: 'Routine',
      caregiverId: '',
      notes: '',
      isRecurring: false,
      repeatFrequency: '',
      repeatDays: [],
      repeatMonthlyRules: [{ ordinal: null, weekday: null }],
      repeatStart: today,
      repeatEnd: '',
    })
    setVisitAdlSelected(new Set())
    setAddVisitTab('details')
    setVisitError(null)
    setScheduleLimitWarning(null)
    setAddVisitModalOpen(true)
  }

  const closeAddVisitModal = () => {
    if (!isSavingVisit) {
      setAddVisitModalOpen(false)
      setCaregiverPickerOpen(false)
      setCaregiverPickerFilter('all')
    }
  }

  const openEditVisitModal = (schedule: ScheduleRow) => {
    const start = (schedule.start_time ?? '09:00').slice(0, 5)
    const end = (schedule.end_time ?? '10:00').slice(0, 5)
    setCaregiverPickerOpen(false)
    setCaregiverPickerFilter('all')
    setEditingSchedule(schedule)
    setVisitForm({
      date: schedule.date,
      startTime: start,
      endTime: end,
      description: schedule.description ?? '',
      type: (schedule.type ?? 'Routine') as string,
      caregiverId: schedule.caregiver_id ?? '',
      notes: schedule.notes ?? '',
      isRecurring: schedule.is_recurring ?? false,
      repeatFrequency: schedule.repeat_frequency ?? '',
      repeatDays: Array.isArray(schedule.days_of_week) ? schedule.days_of_week : [],
      repeatMonthlyRules: (() => {
        const rules = (schedule as { repeat_monthly_rules?: { ordinal: number; weekday: number }[] }).repeat_monthly_rules
        if (Array.isArray(rules) && rules.length > 0) {
          return [...rules.map((r) => ({ ordinal: r.ordinal, weekday: r.weekday })), { ordinal: null as number | null, weekday: null as number | null }]
        }
        return [{ ordinal: null, weekday: null }]
      })(),
      repeatStart: schedule.repeat_start ?? schedule.date,
      repeatEnd: schedule.repeat_end ?? '',
    })
    {
      const dow = getDayOfWeekDb(schedule.date)
      const next = new Set<string>()
      for (const t of schedule.adl_codes ?? []) {
        next.add(normalizeScheduleAdlToken(t, dow, localAdlSchedules))
      }
      setVisitAdlSelected(next)
    }
    setAddVisitTab('details')
    setVisitError(null)
    setScheduleLimitWarning(null)
    setEditVisitModalOpen(true)
  }

  const closeEditVisitModal = () => {
    if (!isSavingVisit) {
      setEditVisitModalOpen(false)
      setEditingSchedule(null)
      setCaregiverPickerOpen(false)
      setCaregiverPickerFilter('all')
    }
  }

  const openManageLimitModal = () => {
    const monday = getMonday(new Date())
    const mondayStr = toLocalDateString(monday)
    setLimitForm({ totalHours: '', effectiveDate: mondayStr, note: '' })
    setLimitError(null)
    setManageLimitModalOpen(true)
  }

  const closeManageLimitModal = () => {
    if (!isSavingLimit) setManageLimitModalOpen(false)
  }

  const normalizeToWeekStart = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00')
    return toLocalDateString(getMonday(d))
  }

  const handleAddVisitSubmit = async () => {
    if (!visitForm.startTime || !visitForm.endTime) {
      setVisitError('Please set start time and end time.')
      return
    }
    if (visitAdlSelected.size === 0) {
      setVisitError('Please select at least one ADL task in the ADLs tab.')
      return
    }
    if (!visitForm.isRecurring && !visitForm.date) {
      setVisitError('Please set date.')
      return
    }
    if (visitForm.isRecurring && !visitForm.repeatStart) {
      setVisitError('Please set Start Date in the Recurring section.')
      return
    }
    if (visitForm.isRecurring && visitForm.repeatFrequency === 'daily' && !visitForm.repeatEnd) {
      setVisitError('Please set End Date in the Recurring section for daily recurrence.')
      return
    }
    if (visitForm.isRecurring && visitForm.repeatFrequency === 'weekly' && visitForm.repeatDays.length === 0) {
      setVisitError('Please select at least one day of the week.')
      return
    }
    setVisitError(null)
    setScheduleLimitWarning(null)

    const startTime = visitForm.startTime.length === 5 ? visitForm.startTime : visitForm.startTime.slice(0, 5)
    const endTime = visitForm.endTime.length === 5 ? visitForm.endTime : visitForm.endTime.slice(0, 5)
    const startParts = visitForm.startTime.split(':').map(Number)
    const endParts = visitForm.endTime.split(':').map(Number)
    const newMins = (endParts[0] * 60 + (endParts[1] ?? 0)) - (startParts[0] * 60 + (startParts[1] ?? 0))

    let datesToInsert: string[] = []
    if (!visitForm.isRecurring) {
      datesToInsert = [visitForm.date]
    } else {
      const repStart = visitForm.repeatStart!
      const repEnd = visitForm.repeatEnd || repStart
      if (visitForm.repeatFrequency === 'daily') {
        datesToInsert = datesBetween(repStart, repEnd)
      } else if (visitForm.repeatFrequency === 'weekly') {
        const end = visitForm.repeatEnd || (() => {
          const d = new Date(repStart + 'T12:00:00')
          d.setDate(d.getDate() + 6)
          return toLocalDateString(d)
        })()
        datesToInsert = datesWeeklyBetween(repStart, end, visitForm.repeatDays)
      } else if (visitForm.repeatFrequency === 'monthly') {
        const monthlyRules = visitForm.repeatMonthlyRules.filter(
          (r): r is { ordinal: number; weekday: number } => r.ordinal != null && r.weekday != null
        )
        if (monthlyRules.length === 0) {
          setVisitError('Please add at least one week and day for monthly repeat.')
          return
        }
        const end = visitForm.repeatEnd || (() => {
          const d = new Date(repStart + 'T12:00:00')
          d.setMonth(d.getMonth() + 1)
          d.setDate(0)
          return toLocalDateString(d)
        })()
        datesToInsert = datesMonthlyBetweenFromRules(repStart, end, monthlyRules)
      }
    }

    if (visitForm.isRecurring && datesToInsert.length === 0) {
      setVisitError('No dates in the selected range. Check Start Date and End Date.')
      return
    }

    const minDate = datesToInsert[0]
    const maxDate = datesToInsert[datesToInsert.length - 1]
    setScheduleLimitWarning(null)

    const timeToMins = (t: string) => {
      const [h, m] = (t ?? '0:0').split(':').map(Number)
      return h * 60 + (m ?? 0)
    }
    const newStartMins = timeToMins(startTime)
    const newEndMins = timeToMins(endTime)
    const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
      aStart < bEnd && aEnd > bStart

    const supabase = createClient()
    const { data: existingInRange } = await q.getSchedulesByPatientIdAndDateRange(
      supabase,
      localClient.id,
      minDate,
      maxDate
    )
    const overlappingIds = new Set<string>()
    for (const dateStr of datesToInsert) {
      for (const s of existingInRange ?? []) {
        if (s.date !== dateStr) continue
        const sStart = timeToMins(s.start_time ?? '0:0')
        const sEnd = timeToMins(s.end_time ?? '0:0')
        if (overlaps(newStartMins, newEndMins, sStart, sEnd)) overlappingIds.add(s.id)
      }
    }
    if (overlappingIds.size > 0) {
      const ok = typeof window !== 'undefined' && window.confirm(
        'Schedule for this time is already added. Do you replace it?'
      )
      if (!ok) return
    }

    setIsSavingVisit(true)
    try {
      const idsToReplace = Array.from(overlappingIds)
      for (let i = 0; i < idsToReplace.length; i++) {
        await q.deleteSchedule(supabase, idsToReplace[i])
      }
      const basePayload = {
        patient_id: localClient.id,
        start_time: startTime,
        end_time: endTime,
        description: visitForm.description || null,
        type: visitForm.type || 'Routine',
        caregiver_id: visitForm.caregiverId || null,
        notes: visitForm.notes || null,
        adl_codes: Array.from(visitAdlSelected),
        is_recurring: visitForm.isRecurring,
        repeat_frequency: visitForm.isRecurring ? visitForm.repeatFrequency || null : null,
        days_of_week:
          visitForm.isRecurring && visitForm.repeatFrequency === 'weekly' && visitForm.repeatDays.length
            ? visitForm.repeatDays
            : null,
        repeat_monthly_rules:
          visitForm.isRecurring && visitForm.repeatFrequency === 'monthly'
            ? visitForm.repeatMonthlyRules.filter(
                (r): r is { ordinal: number; weekday: number } => r.ordinal != null && r.weekday != null
              )
            : null,
        repeat_start: visitForm.isRecurring ? visitForm.repeatStart || null : null,
        repeat_end: visitForm.isRecurring && visitForm.repeatEnd ? visitForm.repeatEnd : null,
      }
      for (const dateStr of datesToInsert) {
        const { error } = await q.insertSchedule(supabase, { ...basePayload, date: dateStr })
        if (error) {
          setVisitError(error.message ?? 'Failed to add visit.')
          return
        }
      }
      if (maxDate >= scheduleWeekStartStr && minDate <= scheduleWeekEndStr) {
        const { data } = await q.getSchedulesByPatientIdAndDateRange(
          supabase,
          localClient.id,
          scheduleWeekStartStr,
          scheduleWeekEndStr
        )
        setWeekSchedules(data ?? [])
      }
      setAddVisitModalOpen(false)
      router.refresh()
    } catch (e) {
      setVisitError(e instanceof Error ? e.message : 'Failed to add visit.')
    } finally {
      setIsSavingVisit(false)
    }
  }

  const handleUpdateVisitSubmit = async () => {
    if (!editingSchedule) return
    if (!visitForm.startTime || !visitForm.endTime) {
      setVisitError('Please set start time and end time.')
      return
    }
    if (visitAdlSelected.size === 0) {
      setVisitError('Please select at least one ADL task in the ADLs tab.')
      return
    }
    if (!visitForm.isRecurring && !visitForm.date) {
      setVisitError('Please set date.')
      return
    }
    setVisitError(null)
    setScheduleLimitWarning(null)
    const dateToSave = visitForm.isRecurring ? editingSchedule.date : visitForm.date!
    const newStartParts = visitForm.startTime.split(':').map(Number)
    const newEndParts = visitForm.endTime.split(':').map(Number)
    const newVisitMins = (newEndParts[0] * 60 + (newEndParts[1] ?? 0)) - (newStartParts[0] * 60 + (newStartParts[1] ?? 0))
    setIsSavingVisit(true)
    try {
      const supabase = createClient()
      const { error } = await q.updateSchedule(supabase, editingSchedule.id, {
        date: dateToSave,
        start_time: visitForm.startTime.length === 5 ? visitForm.startTime : visitForm.startTime.slice(0, 5),
        end_time: visitForm.endTime.length === 5 ? visitForm.endTime : visitForm.endTime.slice(0, 5),
        description: visitForm.description || null,
        type: visitForm.type || 'Routine',
        caregiver_id: visitForm.caregiverId || null,
        notes: visitForm.notes || null,
        adl_codes: Array.from(visitAdlSelected),
        is_recurring: visitForm.isRecurring,
        repeat_frequency: visitForm.isRecurring ? visitForm.repeatFrequency || null : null,
        days_of_week:
          visitForm.isRecurring && visitForm.repeatFrequency === 'weekly' && visitForm.repeatDays.length
            ? visitForm.repeatDays
            : null,
        repeat_monthly_rules:
          visitForm.isRecurring && visitForm.repeatFrequency === 'monthly'
            ? visitForm.repeatMonthlyRules.filter(
                (r): r is { ordinal: number; weekday: number } => r.ordinal != null && r.weekday != null
              )
            : null,
        repeat_start: visitForm.isRecurring ? visitForm.repeatStart || null : null,
        repeat_end: visitForm.isRecurring && visitForm.repeatEnd ? visitForm.repeatEnd : null,
      })
      if (error) {
        setVisitError(error.message ?? 'Failed to update visit.')
        return
      }
      if (dateToSave >= scheduleWeekStartStr && dateToSave <= scheduleWeekEndStr) {
        const { data } = await q.getSchedulesByPatientIdAndDateRange(
          supabase,
          localClient.id,
          scheduleWeekStartStr,
          scheduleWeekEndStr
        )
        setWeekSchedules(data ?? [])
      }
      setEditVisitModalOpen(false)
      setEditingSchedule(null)
      router.refresh()
    } catch (e) {
      setVisitError(e instanceof Error ? e.message : 'Failed to update visit.')
    } finally {
      setIsSavingVisit(false)
    }
  }

  const handleMarkVisitMissed = async () => {
    if (!editingSchedule) return
    setIsSavingVisit(true)
    try {
      const supabase = createClient()
      const { error } = await q.updateSchedule(supabase, editingSchedule.id, { status: 'missed' })
      if (!error) {
        const { data } = await q.getSchedulesByPatientIdAndDateRange(
          supabase,
          localClient.id,
          scheduleWeekStartStr,
          scheduleWeekEndStr
        )
        setWeekSchedules(data ?? [])
        setEditVisitModalOpen(false)
        setEditingSchedule(null)
        router.refresh()
      } else {
        setVisitError(error.message ?? 'Failed to mark as missed.')
      }
    } catch (e) {
      setVisitError(e instanceof Error ? e.message : 'Failed to mark as missed.')
    } finally {
      setIsSavingVisit(false)
    }
  }

  const handleMarkVisitUnmissed = async () => {
    if (!editingSchedule) return
    setIsSavingVisit(true)
    try {
      const supabase = createClient()
      const { error } = await q.updateSchedule(supabase, editingSchedule.id, { status: null })
      if (!error) {
        const { data } = await q.getSchedulesByPatientIdAndDateRange(
          supabase,
          localClient.id,
          scheduleWeekStartStr,
          scheduleWeekEndStr
        )
        setWeekSchedules(data ?? [])
        setEditVisitModalOpen(false)
        setEditingSchedule(null)
        router.refresh()
      } else {
        setVisitError(error.message ?? 'Failed to mark as unmissed.')
      }
    } catch (e) {
      setVisitError(e instanceof Error ? e.message : 'Failed to mark as unmissed.')
    } finally {
      setIsSavingVisit(false)
    }
  }

  const handleDeleteVisit = async () => {
    if (!editingSchedule) return
    if (!confirm('Delete this visit? This cannot be undone.')) return
    setIsSavingVisit(true)
    try {
      const supabase = createClient()
      await q.deleteSchedule(supabase, editingSchedule.id)
      setWeekSchedules((prev) => prev.filter((s) => s.id !== editingSchedule.id))
      setEditVisitModalOpen(false)
      setEditingSchedule(null)
      router.refresh()
    } catch (e) {
      setVisitError(e instanceof Error ? e.message : 'Failed to delete visit.')
    } finally {
      setIsSavingVisit(false)
    }
  }

  const handleSaveLimit = async () => {
    const total = parseFloat(limitForm.totalHours)
    if (Number.isNaN(total) || total <= 0) {
      setLimitError('Please enter a valid total amount of hours.')
      return
    }
    if (!limitForm.effectiveDate) {
      setLimitError('Effective date is required.')
      return
    }
    setLimitError(null)
    setIsSavingLimit(true)
    try {
      const supabase = createClient()
      const effectiveWeekStart = normalizeToWeekStart(limitForm.effectiveDate)
      const { data, error } = await q.insertPatientContractedHours(supabase, {
        patient_id: localClient.id,
        total_hours: total,
        effective_date: effectiveWeekStart,
        end_date: null,
        note: limitForm.note || null,
      })
      if (error) {
        setLimitError(error.message ?? 'Failed to save.')
        return
      }
      if (data) setLocalContractedHours((prev) => [data, ...prev])
      setManageLimitModalOpen(false)
      router.refresh()
    } catch (e) {
      setLimitError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setIsSavingLimit(false)
    }
  }

  const handleDeleteLimit = async (id: string) => {
    try {
      const supabase = createClient()
      await q.deletePatientContractedHours(supabase, id)
      setLocalContractedHours((prev) => prev.filter((l) => l.id !== id))
      router.refresh()
    } catch (_) {}
  }

  /** Schedule + overview: most recently added limit (matches top row in Limit History). */
  const latestAddedContractLimit = useMemo((): PatientContractedHoursRow | null => {
    const rows = localContractedHours
    if (rows.length === 0) return null
    let best = rows[0]
    for (let i = 1; i < rows.length; i++) {
      const L = rows[i]
      const cmp = (L.created_at ?? '').localeCompare(best.created_at ?? '')
      if (cmp > 0 || (cmp === 0 && L.id.localeCompare(best.id) > 0)) best = L
    }
    return best
  }, [localContractedHours])

  /**
   * Schedule tab: for the selected week, use the limit that actually governs that week.
   * - If the latest-added row (Limit History "Current") applies to this week, use it — so new limits
   *   match the modal as soon as their effective week is this week or earlier.
   * - If the selected week is before that row's effective date, fall back to the newest limit that
   *   does apply (by effective_date), so past weeks don't show a future-dated limit.
   */
  const limitAppliesToWeekStart = (row: PatientContractedHoursRow, weekStart: string) =>
    row.effective_date <= weekStart && (row.end_date == null || row.end_date >= weekStart)

  const currentLimitForWeek = useMemo((): PatientContractedHoursRow | null => {
    const weekStart = scheduleWeekStartStr
    if (
      latestAddedContractLimit &&
      limitAppliesToWeekStart(latestAddedContractLimit, weekStart)
    ) {
      return latestAddedContractLimit
    }
    const applicable = localContractedHours.filter((row) => limitAppliesToWeekStart(row, weekStart))
    if (applicable.length === 0) return null
    let best = applicable[0]
    for (let i = 1; i < applicable.length; i++) {
      const L = applicable[i]
      const cmp = L.effective_date.localeCompare(best.effective_date)
      if (cmp > 0 || (cmp === 0 && L.id.localeCompare(best.id) > 0)) best = L
    }
    return best
  }, [latestAddedContractLimit, localContractedHours, scheduleWeekStartStr])

  const scheduledHoursForWeek = useMemo(() => {
    return weekSchedules.reduce((acc, s) => {
      const [sh, sm] = (s.start_time ?? '0:0').split(':').slice(0, 2).map(Number)
      const [eh, em] = (s.end_time ?? '0:0').split(':').slice(0, 2).map(Number)
      return acc + (eh * 60 + em - sh * 60 - sm) / 60
    }, 0)
  }, [weekSchedules])

  const currentEffectiveLimit = latestAddedContractLimit
  const limitHistoryRows = useMemo(
    () =>
      [...localContractedHours].sort((a, b) => {
        const byEffective = b.effective_date.localeCompare(a.effective_date)
        if (byEffective !== 0) return byEffective
        return (b.created_at ?? '').localeCompare(a.created_at ?? '')
      }),
    [localContractedHours]
  )

  /** Overview card: older limits (same order as history table, excluding current row). */
  const contractedHoursPreviousRows = useMemo(() => {
    if (!currentEffectiveLimit) return []
    return limitHistoryRows.filter((r) => r.id !== currentEffectiveLimit.id)
  }, [limitHistoryRows, currentEffectiveLimit])

  const skillsByType = CAREGIVER_SKILL_POINTS.reduce<Record<string, { type: string; name: string }[]>>((acc, s) => {
    if (!acc[s.type]) acc[s.type] = []
    acc[s.type].push(s)
    return acc
  }, {})
  const CAREGIVER_REQUIREMENTS_TYPE_ORDER = [
    'Clinical Care',
    'Specialty Conditions',
    'Physical Support',
    'Daily Living',
    'Certifications',
    'Language',
  ]
  const categoryColors: Record<string, string> = {
    'Clinical Care': 'ring-red-500 bg-red-500 text-white',
    'Specialty Conditions': 'ring-purple-500 bg-purple-500 text-white',
    'Physical Support': 'ring-amber-600 bg-amber-600 text-white',
    'Daily Living': 'ring-green-600 bg-green-600 text-white',
    'Certifications': 'ring-blue-500 bg-blue-500 text-white',
    'Language': 'ring-teal-500 bg-teal-500 text-white',
  }

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'medical', label: 'Medical Info' },
    { id: 'representatives', label: 'Representatives' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'adls', label: 'ADLs' },
    { id: 'documents', label: 'Documents' },
    { id: 'caregiver-requirements', label: 'Caregiver Requirements' },
    { id: 'incidents', label: 'Incidents' },
  ]

  return (
    <div className="space-y-6">
      {/* Navigation Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Link
            href="/pages/agency/clients"
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Clients
          </Link>

          {/* Previous/Next Navigation */}
          <div
            className="relative flex items-stretch gap-0 border border-gray-300 rounded-lg min-h-[42px]"
            aria-busy={isClientSwitching}
          >
            {isClientSwitching ? (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-lg bg-white/80 backdrop-blur-[1px]"
                aria-live="polite"
              >
                <Loader2 className="w-5 h-5 animate-spin text-gray-700 shrink-0" aria-hidden />
                <span className="text-sm font-medium text-gray-700">Loading client…</span>
              </div>
            ) : null}
            <button
              type="button"
              onClick={handlePrevious}
              disabled={!previousClient || isClientSwitching}
              className="p-2 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded-l-lg"
              aria-label="Previous client"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <select
              value={localClient.id}
              onChange={(e) => handleClientChange(e.target.value)}
              disabled={isClientSwitching}
              className="min-w-0 flex-1 px-4 py-2 border-0 border-l border-r border-gray-200 focus:ring-0 focus:outline-none bg-transparent cursor-pointer disabled:cursor-wait disabled:opacity-70"
            >
              {allClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleNext}
              disabled={!nextClient || isClientSwitching}
              className="p-2 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors rounded-r-lg"
              aria-label="Next client"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Client Overview Header */}
      <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center text-white font-semibold text-xl">
            {getInitials(localClient.full_name)}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-gray-900">{localClient.full_name}</h1>
              <span className={`px-3 py-1 text-xs font-semibold rounded ${
                clientStatus === 'active' 
                  ? 'bg-green-100 text-green-800' 
                  : 'bg-gray-100 text-gray-800'
              }`}>
                {clientStatus === 'active' ? 'Active' : 'Inactive'}
              </span>
              {localClient.class && (
                <span className="px-3 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded">
                  {localClient.class}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-gray-600 mb-4">
              <MapPin className="w-4 h-4" />
              <span>{localClient.street_address}, {localClient.city}, {localClient.state} {localClient.zip_code}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gray-400" />
                <span><strong>Date of Birth:</strong> {formatShortDate(localClient.date_of_birth)} (Age {localClient.age || 'N/A'})</span>
              </div>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-gray-400" />
                <span><strong>Gender:</strong> {localClient.gender || 'N/A'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-gray-400" />
                <span><strong>Phone:</strong> {localClient.phone_number}</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-gray-400" />
                <span><strong>Email:</strong> {localClient.email_address}</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gray-400" />
                <span><strong>Enrolled:</strong> {formatShortDate(localClient.created_at)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Personal Information Card */}
              <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Personal Information</h3>
                  {isEditingPersonal ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={cancelEditPersonal}
                        disabled={isSavingPersonal}
                        className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200 rounded-lg disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        form="form-personal"
                        disabled={isSavingPersonal}
                        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {isSavingPersonal ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Save
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={startEditPersonal}
                      className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                      aria-label="Edit personal information"
                    >
                    <Edit className="w-4 h-4 text-gray-600" />
                  </button>
                  )}
                </div>
                {isEditingPersonal ? (
                  <form id="form-personal" onSubmit={handleSavePersonal} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {personalEditError && (
                      <div className="md:col-span-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
                        {personalEditError}
                      </div>
                    )}
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Full Name</label>
                      <input
                        type="text"
                        value={editPersonalForm.full_name}
                        onChange={(e) => setEditPersonalForm((p) => ({ ...p, full_name: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        disabled={isSavingPersonal}
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Gender</label>
                      <select
                        value={editPersonalForm.gender}
                        onChange={(e) => setEditPersonalForm((p) => ({ ...p, gender: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        disabled={isSavingPersonal}
                      >
                        <option value="">Select...</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                        <option value="Prefer not to say">Prefer not to say</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Date of Birth</label>
                      <input
                        type="date"
                        value={editPersonalForm.date_of_birth}
                        onChange={(e) => {
                          const date_of_birth = e.target.value
                          setEditPersonalForm((p) => ({
                            ...p,
                            date_of_birth,
                            age: date_of_birth ? ageFromDob(date_of_birth) : 0,
                          }))
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        disabled={isSavingPersonal}
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-600 mb-1">Age</label>
                      <input
                        type="number"
                        min={0}
                        max={150}
                        value={editPersonalForm.age || ''}
                        onChange={(e) => {
                          const v = e.target.value === '' ? 0 : parseInt(e.target.value, 10)
                          const age = isNaN(v) ? 0 : Math.min(150, Math.max(0, v))
                          setEditPersonalForm((p) => ({ ...p, age, date_of_birth: dobFromAge(age) }))
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        disabled={isSavingPersonal}
                        placeholder="Age"
                      />
                    </div>
                  </form>
                ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm text-gray-600">Full Name:</span>
                      <p className="text-sm font-medium text-gray-900">{localClient.full_name}</p>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">Gender:</span>
                      <p className="text-sm font-medium text-gray-900">{localClient.gender || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">Date of Birth:</span>
                      <p className="text-sm font-medium text-gray-900">{formatDate(localClient.date_of_birth)}</p>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">Age:</span>
                      <p className="text-sm font-medium text-gray-900">{localClient.age || 'N/A'} years</p>
                  </div>
                </div>
                )}
              </div>

              {/* Status Management Card */}
              <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Status Management</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Client Status</p>
                      <p className="text-xs text-gray-500">Set whether this client is actively receiving care</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={clientStatus === 'active'}
                        onChange={(e) => handleStatusToggle(e.target.checked ? 'active' : 'inactive')}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                  {/* <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Login Access</p>
                      <p className="text-xs text-gray-500">Control portal login access for this client</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={loginAccess}
                        onChange={(e) => handleLoginAccessToggle(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div> */}
                </div>
              </div>

              {/* Contracted Weekly Hours Card */}
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <Timer className="w-5 h-5 text-blue-600" aria-hidden />
                    <h3 className="text-lg font-bold text-gray-900">Contracted Weekly Hours</h3>
                  </div>
                  <button
                    type="button"
                    onClick={openManageLimitModal}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
                  >
                    <Plus className="w-4 h-4" />
                    Set Limit
                  </button>
                </div>
                {!currentEffectiveLimit ? (
                  <div className="p-6">
                    <div className="rounded-lg border-2 border-dashed border-gray-200 p-8 flex flex-col items-center justify-center min-h-[140px]">
                      <Timer className="w-12 h-12 text-gray-300 mb-3" aria-hidden />
                      <p className="text-sm font-medium text-gray-500 mb-4">No weekly hours limit set</p>
                      <button
                        type="button"
                        onClick={openManageLimitModal}
                        className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-gray-800"
                      >
                        <Plus className="w-4 h-4" />
                        Set Hours Limit
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-4">
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-gray-900">{currentEffectiveLimit.total_hours}</span>
                      <span className="text-sm text-gray-500">hrs / week</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Effective {parseDateOnly(currentEffectiveLimit.effective_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                    {contractedHoursPreviousRows.length > 0 && (
                      <>
                        <div className="my-4 border-t border-gray-200" aria-hidden />
                        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-2.5">
                          <History className="w-3.5 h-3.5 shrink-0 text-gray-400" aria-hidden />
                          <span>Previous limits</span>
                        </div>
                        <ul className="space-y-2">
                          {contractedHoursPreviousRows.map((row) => (
                            <li
                              key={row.id}
                              className="flex items-center justify-between gap-3 text-xs text-gray-500"
                            >
                              <span>{row.total_hours} hrs</span>
                              <span className="shrink-0 tabular-nums">
                                from{' '}
                                {parseDateOnly(row.effective_date).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                })}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Contact Information Card */}
              <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Contact Information</h3>
                  {/* <button className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
                    <Edit className="w-4 h-4 text-gray-600" />
                  </button> */}
                </div>
                <div className="space-y-3">
                  <div>
                    <span className="text-sm text-gray-600">Address:</span>
                    <p className="text-sm font-medium text-gray-900">
                      {localClient.street_address} {localClient.city}, {localClient.state} {localClient.zip_code}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">Phone Number:</span>
                    <p className="text-sm font-medium text-gray-900">{localClient.phone_number}</p>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">Email Address:</span>
                    <p className="text-sm font-medium text-gray-900">{localClient.email_address}</p>
                  </div>
                </div>
              </div>

              {/* Emergency Contact Card */}
              <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Emergency Contact</h3>
                  {/* <button className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
                    <Edit className="w-4 h-4 text-gray-600" />
                  </button> */}
                </div>
                <div className="space-y-3">
                  <div>
                    <span className="text-sm text-gray-600">Contact Name:</span>
                    <p className="text-sm font-medium text-gray-900">{localClient.emergency_contact_name}</p>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600">Phone Number:</span>
                    <p className="text-sm font-medium text-gray-900">{localClient.emergency_phone}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'medical' && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900">Medical Information</h3>
                  {isEditingMedical ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={cancelEditMedical}
                        disabled={isSavingMedical}
                        className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200 rounded-lg disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        form="form-medical"
                        disabled={isSavingMedical}
                        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {isSavingMedical ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Save
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={startEditMedical}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors"
                      aria-label="Edit medical information"
                    >
                      <Edit className="w-4 h-4" />
                      Edit
                    </button>
                  )}
                </div>
                {isEditingMedical ? (
                  <form id="form-medical" onSubmit={handleSaveMedical} className="space-y-4">
                    {medicalEditError && (
                      <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
                        {medicalEditError}
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Primary Diagnosis</label>
                      <input
                        ref={primaryDiagnosisInputRef}
                        type="text"
                        value={editMedicalForm.primary_diagnosis}
                        onChange={(e) => setEditMedicalForm((p) => ({ ...p, primary_diagnosis: e.target.value }))}
                        className="w-full px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm font-medium text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        disabled={isSavingMedical}
                        placeholder="e.g. Alzheimer's Disease, Stage 2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Current Medications</label>
                      <textarea
                        rows={3}
                        value={editMedicalForm.current_medications}
                        onChange={(e) => setEditMedicalForm((p) => ({ ...p, current_medications: e.target.value }))}
                        className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent whitespace-pre-line"
                        disabled={isSavingMedical}
                        placeholder="e.g. Donepezil 10mg daily, Lisinopril 20mg daily"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Allergies</label>
                      <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-300 rounded-lg">
                        <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" aria-hidden />
                        <input
                          type="text"
                          value={editMedicalForm.allergies}
                          onChange={(e) => setEditMedicalForm((p) => ({ ...p, allergies: e.target.value }))}
                          className="flex-1 bg-transparent border-0 text-sm font-medium text-red-700 placeholder-red-400 focus:ring-0 focus:outline-none"
                          disabled={isSavingMedical}
                          placeholder="e.g. Penicillin"
                        />
                      </div>
                    </div>
                  </form>
                ) : (
                <div className="space-y-4">
                  <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Primary Diagnosis</label>
                      <div className="mt-1 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-sm font-medium text-gray-900">
                          {localClient.primary_diagnosis || 'Not specified'}
                        </p>
                      </div>
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Current Medications</label>
                      <div className="mt-1 px-4 py-3 bg-white border border-gray-300 rounded-lg">
                        <p className="text-sm font-medium text-gray-900 whitespace-pre-line">
                          {localClient.current_medications || 'None listed'}
                        </p>
                      </div>
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Allergies</label>
                      <div className="mt-1 px-4 py-3 bg-red-50 border border-red-300 rounded-lg flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" aria-hidden />
                        <p className="text-sm font-medium text-red-700 whitespace-pre-line">
                          {localClient.allergies || 'None listed'}
                    </p>
                  </div>
                </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'representatives' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {repListError && (
                <div className="md:col-span-2 p-3 bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-lg text-sm">
                  {repListError}
                </div>
              )}
              {sortedRepresentatives.map((rep, index) => (
                <div key={rep.id} className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-bold text-gray-900">Representative #{index + 1}</h3>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditRep(rep)}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        aria-label={`Edit representative ${index + 1}`}
                      >
                        <Edit className="w-4 h-4 text-gray-600" />
                      </button>
                      <button
                        type="button"
                        onClick={() => confirmDeleteRep(rep)}
                        disabled={deletingRepId === rep.id}
                        className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        aria-label={`Delete representative ${index + 1}`}
                      >
                        {deletingRepId === rep.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <span className="block text-xs text-gray-500 mb-0.5">Name</span>
                      <p className="text-sm font-medium text-gray-900">{rep.name || '—'}</p>
                    </div>
                    <div>
                      <span className="block text-xs text-gray-500 mb-0.5">Relationship</span>
                      <p className="text-sm font-medium text-gray-900">{rep.relationship || '—'}</p>
                    </div>
                    <div>
                      <span className="block text-xs text-gray-500 mb-0.5">Phone Number</span>
                      <p className="text-sm font-medium text-gray-900">{rep.phone_number || '—'}</p>
                    </div>
                    <div>
                      <span className="block text-xs text-gray-500 mb-0.5">Email Address</span>
                      <p className="text-sm font-medium text-gray-900">{rep.email_address || '—'}</p>
                    </div>
                  </div>
                </div>
              ))}
              {/* Empty card for adding next representative */}
              <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold text-gray-900">Representative #{sortedRepresentatives.length + 1}</h3>
                  <button
                    type="button"
                    onClick={() => openAddRep(nextRepDisplayOrder)}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors opacity-0 hover:opacity-100"
                    aria-label={`Add representative ${sortedRepresentatives.length + 1}`}
                  >
                    <Edit className="w-4 h-4 text-gray-600" />
                  </button>
                </div>
                <div className="flex flex-col items-center justify-center py-8">
                  <Users className="w-12 h-12 text-gray-300 mb-3" />
                  <p className="text-sm text-gray-500 mb-4">No representative added</p>
                  <button
                    type="button"
                    onClick={() => openAddRep(nextRepDisplayOrder)}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Representative
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'documents' && (
            <div className="w-full">
              <div className="text-center mb-8">
                <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Document Management</h3>
                <p className="text-sm text-gray-500 mb-6">Upload and manage client documents and files. You can select multiple files at once.</p>
                {documentUploadError && (
                  <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-lg text-sm">
                    {documentUploadError}
                  </div>
                )}
                <input
                  ref={documentFileInputRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                  multiple
                  onChange={handleDocumentFileChange}
                />
                <button
                  type="button"
                  onClick={() => documentFileInputRef.current?.click()}
                  disabled={isUploadingDocument}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isUploadingDocument ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  Upload Documents
                </button>
                      </div>
              {patientDocuments.length > 0 ? (
                <ul className="border border-gray-200 rounded-lg divide-y divide-gray-200">
                  {patientDocuments.map((doc) => (
                    <li key={doc.id} className="flex items-center justify-between gap-4 px-4 py-3 bg-white hover:bg-gray-50">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <FileText className="w-5 h-5 text-gray-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{doc.name}</p>
                          {doc.uploaded_at && (
                            <p className="text-xs text-gray-500">
                              {new Date(doc.uploaded_at).toLocaleDateString()}
                            </p>
                          )}
                    </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {doc.url && (
                          <button
                            type="button"
                            onClick={() => downloadPatientDocument(doc)}
                            disabled={downloadingDocId === doc.id}
                            className="p-2 text-gray-500 hover:text-blue-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                            aria-label={`Download ${doc.name}`}
                          >
                            {downloadingDocId === doc.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setDocumentUploadError(null)
                            setDocToDelete(doc)
                          }}
                          disabled={isDeletingDocId === doc.id}
                          className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                          aria-label="Delete document"
                        >
                          {isDeletingDocId === doc.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : ''}
            </div>
          )}

          {activeTab === 'caregiver-requirements' && (
            <div className="w-full">
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex items-start justify-between gap-4 p-6 border-b border-gray-200">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <Sparkles className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">Required Caregiver Skills</h3>
                      <p className="text-sm text-gray-500 mt-0.5">
                        Skills a caregiver must have to be matched to {localClient.full_name}.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={openCaregiverReqsModal}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                    Edit Requirements
                  </button>
                </div>
                <div className="p-6">
                  <div className={`border-2 border-dashed border-gray-200 rounded-lg min-h-[200px] flex flex-col py-12 px-4 ${caregiverRequirements.length > 0 ? 'items-start justify-start' : 'items-center justify-center'}`}>
                    {caregiverRequirements.length > 0 ? (
                      <div className="w-full space-y-4">
                        {CAREGIVER_REQUIREMENTS_TYPE_ORDER.map((type) => {
                          const skillsInType = caregiverRequirements.filter((code) => {
                            const skill = CAREGIVER_SKILL_POINTS.find((s) => s.name === code)
                            return skill?.type === type
                          })
                          if (skillsInType.length === 0) return null
                          const color = categoryColors[type] ?? 'ring-gray-400 bg-gray-400 text-white'
                          return (
                            <div key={type}>
                              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                                {type.toUpperCase()}
                              </h4>
                              <div className="flex flex-wrap gap-2">
                                {skillsInType.map((code) => (
                                  <span
                                    key={code}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ring-2 ${color}`}
                                  >
                                    {code}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                        <p className="text-sm text-gray-500 pt-2">
                          {caregiverRequirements.length} skill{caregiverRequirements.length !== 1 ? 's' : ''} required
                        </p>
                      </div>
                    ) : (
                      <>
                        <Sparkles className="w-12 h-12 text-gray-300 mb-3" />
                        <p className="text-sm text-gray-500 mb-4">No caregiver skills required yet.</p>
                        <button
                          type="button"
                          onClick={openCaregiverReqsModal}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                          Add Requirements
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'incidents' && (
            <div className="w-full space-y-4">
              {/* Warning banner */}
              <div className="rounded-lg border border-amber-400 bg-[#FFF8E5] px-4 py-3 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden />
                <p className="text-sm text-gray-900">
                  Important: Incident reports must also be stored outside this system — in your agency&apos;s physical records, secure file server, or compliance storage — in accordance with applicable regulations.
                </p>
                      </div>

              {/* Section header */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" aria-hidden />
                    Incident Reports
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {localIncidents.length === 0
                      ? 'No incident reports on file.'
                      : `${localIncidents.length} report${localIncidents.length === 1 ? '' : 's'} on file.`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openReportIncidentModal}
                  className="inline-flex items-center gap-2 px-4 py-2 border-2 border-gray-900 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Report Incident
                </button>
              </div>

              {incidentListError && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-lg text-sm">
                  {incidentListError}
                    </div>
                  )}

              {localIncidents.length > 0 ? (
                <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-600">
                          <th className="px-4 py-3">Incident Date</th>
                          <th className="px-4 py-3">Reporting Date</th>
                          <th className="px-4 py-3">Primary Contact</th>
                          <th className="px-4 py-3">Description</th>
                          <th className="px-4 py-3">File</th>
                          <th className="px-4 py-3">Uploaded</th>
                          <th className="px-4 py-3 text-right">Download</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {localIncidents.map((incident) => {
                          const fileUrl = getIncidentFileUrl(incident)
                          return (
                            <tr key={incident.id} className="bg-white hover:bg-gray-50">
                              <td className="px-4 py-3 text-gray-900">{formatIncidentDate(incident.incident_date)}</td>
                              <td className="px-4 py-3 text-gray-900">{formatIncidentDate(incident.reporting_date)}</td>
                              <td className="px-4 py-3 text-gray-900">{incident.primary_contact_person}</td>
                              <td className="px-4 py-3 text-gray-900 max-w-xs truncate" title={incident.description}>{incident.description}</td>
                              <td className="px-4 py-3">
                                {incident.file_name && fileUrl ? (
                                  <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                                    <FileText className="w-4 h-4 shrink-0" />
                                    {incident.file_name}
                                  </a>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-gray-600">{formatIncidentUploadedAt(incident.created_at)}</td>
                              <td className="px-4 py-3 text-right">
                                {fileUrl ? (
                                  <button
                                    type="button"
                                    onClick={() => downloadIncidentFile(incident)}
                                    disabled={downloadingIncidentId === incident.id}
                                    className="inline-flex p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                                    aria-label={incident.file_name ? `Download ${incident.file_name}` : 'Download file'}
                                  >
                                    {downloadingIncidentId === incident.id ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <Download className="w-4 h-4" />
                                    )}
                                  </button>
                                ) : (
                                  <span className="text-gray-300">—</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                </div>
              </div>
              ) : (
                <div className="border-2 border-dashed border-gray-300 rounded-lg bg-white p-12 flex flex-col items-center justify-center text-center">
                  <AlertTriangle className="w-12 h-12 text-gray-300 mb-4" aria-hidden />
                  <p className="text-gray-500 mb-6">No incident reports have been filed for this client.</p>
                  <button
                    type="button"
                    onClick={openReportIncidentModal}
                    className="inline-flex items-center gap-2 px-6 py-3 border border-gray-300 bg-white text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    File First Report
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'schedule' && (
            <div className="w-full space-y-4">
              {/* Weekly Contracted Hours card (when limit set) or simple header + message */}
              {(() => {
                const contracted = currentLimitForWeek ? Number(currentLimitForWeek.total_hours) : 0
                const overBy = currentLimitForWeek ? Math.max(0, scheduledHoursForWeek - contracted) : 0
                const remaining = currentLimitForWeek ? Math.max(0, contracted - scheduledHoursForWeek) : 0
                const isOverLimit = currentLimitForWeek ? scheduledHoursForWeek > contracted : false
                const isAtLimit = currentLimitForWeek ? Math.abs(scheduledHoursForWeek - contracted) < 0.0001 : false
                const usedPct = currentLimitForWeek && contracted > 0
                  ? Math.min(100, (scheduledHoursForWeek / contracted) * 100)
                  : 0
                const cardTone = isOverLimit
                  ? 'rounded-lg border border-red-300 bg-red-50/40 p-4'
                  : isAtLimit
                    ? 'rounded-lg border border-amber-300 bg-amber-50/40 p-4'
                    : 'rounded-lg border border-blue-200 bg-blue-50/50 p-4'
                const accentBg = isOverLimit
                  ? 'bg-red-100 text-red-500'
                  : isAtLimit
                    ? 'bg-amber-100 text-amber-500'
                    : 'bg-blue-100 text-blue-500'
                const progressBg = isOverLimit ? 'bg-red-200' : isAtLimit ? 'bg-amber-200' : 'bg-blue-200'
                const progressFill = isOverLimit ? 'bg-red-500' : isAtLimit ? 'bg-amber-500' : 'bg-blue-500'
                return (
              <div className={cardTone}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`flex h-8 w-8 items-center justify-center rounded ${accentBg}`}>
                      <TrendingUp className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        THIS WEEK – {formatWeekRangeLabel(scheduleWeekStart, scheduleWeekEnd).toUpperCase()}
                      </p>
                      <h3 className="text-base font-bold text-gray-900">Weekly Contracted Hours</h3>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={openManageLimitModal}
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                  >
                    <Edit className="h-3.5 w-3.5" />
                    Manage Limit
                  </button>
                </div>
                {currentLimitForWeek ? (
                  <>
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <div className={`rounded-lg border p-3 text-center ${isOverLimit ? 'border-gray-200 bg-white' : 'border-gray-200 bg-white'}`}>
                        <p className="text-2xl font-bold text-gray-900">{Number(currentLimitForWeek.total_hours)}</p>
                        <p className="text-xs text-gray-500">Contracted hrs</p>
                      </div>
                      <div className={`rounded-lg border p-3 text-center ${isOverLimit ? 'border-red-300 bg-red-50/40' : 'border-gray-200 bg-white'}`}>
                        <p className={`text-2xl font-bold ${isOverLimit ? 'text-red-600' : 'text-gray-900'}`}>{scheduledHoursForWeek.toFixed(1)}</p>
                        <p className="text-xs text-gray-500">Scheduled hrs</p>
                      </div>
                      <div className={`rounded-lg border p-3 text-center ${isOverLimit ? 'border-red-300 bg-red-50/40' : isAtLimit ? 'border-amber-300 bg-amber-50/40' : 'border-gray-200 bg-white'}`}>
                        <p className={`text-2xl font-bold ${isOverLimit ? 'text-red-600' : isAtLimit ? 'text-amber-600' : 'text-gray-900'}`}>
                          {isOverLimit ? `+${overBy.toFixed(1)}` : remaining.toFixed(1)}
                        </p>
                        <p className="text-xs text-gray-500">{isOverLimit ? 'Over limit' : 'Remaining hrs'}</p>
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className={isOverLimit ? 'text-red-600' : 'text-gray-500'}>
                          {usedPct.toFixed(0)}% of contracted hours used
                        </span>
                        {isOverLimit ? (
                          <span className="inline-flex items-center gap-1 font-medium text-red-600">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Over contracted limit!
                          </span>
                        ) : isAtLimit ? (
                          <span className="inline-flex items-center gap-1 font-medium text-amber-600">
                            <AlertCircle className="h-3.5 w-3.5" />
                            Approaching limit
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-medium text-green-600">
                            <Check className="h-3.5 w-3.5" />
                            Within limit
                          </span>
                        )}
                      </div>
                      {isOverLimit ? (
                        <div className="mt-1.5 w-full">
                          <div className="h-2 w-full overflow-hidden rounded-full bg-red-200">
                            <div
                              className="h-full rounded-full bg-red-500 transition-all"
                              style={{ width: `${usedPct}%` }}
                            />
                          </div>
                          <div className="mt-0.5 h-0.5 w-full overflow-hidden rounded-full bg-red-200">
                            <div
                              className="h-full rounded-full bg-red-500 transition-all"
                              style={{ width: `${Math.min(100, usedPct * 0.67)}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className={`mt-1.5 h-2 w-full overflow-hidden rounded-full ${progressBg}`}>
                          <div
                            className={`h-full rounded-full ${progressFill} transition-all`}
                            style={{ width: `${usedPct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">
                    {localContractedHours.length > 0 ? (
                      <>
                        No limit applies to this calendar week — the selected week is before your newest
                        limit&apos;s effective week, or older limits have ended. Use week navigation to view a
                        week on or after the effective date, or add a limit whose effective week includes this
                        week.
                      </>
                    ) : (
                      <>No weekly hours limit set for this client. Click &apos;Manage Limit&apos; to configure.</>
                    )}
                  </div>
                )}
              </div>
                )
              })()}

              {/* Weekly Care Schedule */}
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Weekly Care Schedule</h3>
                    <p className="text-sm text-gray-500">Client ADL tasks and appointments</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={openAddVisitModal}
                      className="inline-flex items-center rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add Visit
                    </button>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const d = new Date(scheduleWeekStart)
                          d.setDate(d.getDate() - 7)
                          setScheduleWeekStart(getMonday(d))
                        }}
                        className="rounded border border-gray-300 bg-white p-2 text-gray-600 hover:bg-gray-50"
                        aria-label="Previous week"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const d = new Date(scheduleWeekStart)
                          d.setDate(d.getDate() + 7)
                          setScheduleWeekStart(getMonday(d))
                        }}
                        className="rounded border border-gray-300 bg-white p-2 text-gray-600 hover:bg-gray-50"
                        aria-label="Next week"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setScheduleWeekStart(getMonday(new Date()))}
                      className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Today
                    </button>
                  </div>
                </div>

                {/* Calendar grid with Unassigned ADLs row */}
                <div className="relative border border-gray-200 rounded overflow-hidden">
                  <table className="w-full border-collapse text-sm table-fixed">
                    <colgroup>
                      <col className="w-24 text-center" />
                      <col />
                      <col />
                      <col />
                      <col />
                      <col />
                      <col />
                      <col />
                    </colgroup>
                    <thead>
                      <tr className="bg-gray-100 text-center w-full">
                        <th className="w-24 border-b border-r border-gray-200 p-2 text-xs font-medium text-gray-500 align-middle text-center">
                          Unassigned ADLs
                        </th>
                        {getWeekDates().map((d) => {
                          const dateStr = toLocalDateString(d)
                          const dueCount = getDueAdlCountForDay(dateStr)
                          const unassignedCount = getUnassignedAdlCountForDay(dateStr)
                          const isToday =
                            dateStr === toLocalDateString(new Date())
                          return (
                            <th
                              key={dateStr}
                              className={`border-b border-r border-gray-200 p-2 text-center text-sm font-medium last:border-r-0 align-middle ${isToday ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-700'}`}
                            >
                              {dueCount === 0 ? (
                                <span className="text-gray-400">—</span>
                              ) : unassignedCount === 0 ? (
                                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-green-600" aria-label="ADL quota achieved">
                                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                                </span>
                              ) : (
                                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
                                  {unassignedCount}
                                </span>
                              )}
                            </th>
                          )
                        })}
                      </tr>
                      <tr className="bg-gray-50">
                        <th className="w-24 border-b border-r border-gray-200 p-2 text-center text-xs font-medium text-gray-500" />
                        {getWeekDates().map((d) => {
                          const dateStr = toLocalDateString(d)
                          const isToday =
                            dateStr === toLocalDateString(new Date())
                          const isDayHeaderHighlighted = scheduleHover?.dateStr === dateStr
                          return (
                            <th
                              key={dateStr}
                              className={`border-b border-r border-gray-200 p-2 text-center text-xs font-medium last:border-r-0 transition-colors ${isToday ? 'text-blue-600' : 'text-gray-700'}`}
                              style={isDayHeaderHighlighted ? { backgroundColor: '#8ab0ed' } : undefined}
                            >
                              {DAY_LABELS_SHORT[d.getDay()].toUpperCase()} {d.getDate()}
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: 24 }, (_, hour) => {
                        const weekDates = getWeekDates()
                        const parseStartHour = (t: string) => {
                          const [h] = (t || '00:00').split(':').map(Number)
                          return h
                        }
                        const parseEndHourExclusive = (t: string) => {
                          const parts = (t || '00:00').split(':').map(Number)
                          const h = parts[0] ?? 0
                          const m = parts[1] ?? 0
                          if (h === 0 && m === 0) return 24
                          return m > 0 ? h + 1 : h
                        }
                        const isTimeCellHighlighted = scheduleHover && hour >= scheduleHover.startHour && hour < scheduleHover.endHourExclusive
                        return (
                          <tr key={hour} style={{ height: '3rem' }}>
                            <td
                              className="w-24 border-b border-r border-gray-200 p-1 text-center text-xs text-gray-500 align-top transition-colors align-middle"
                              style={{ height: '3rem', ...(isTimeCellHighlighted ? { backgroundColor: '#8ab0ed' } : {}) }}
                            >
                              {hour === 0
                                ? '12 AM'
                                : hour < 12
                                  ? `${hour} AM`
                                  : hour === 12
                                    ? '12 PM'
                                    : `${hour - 12} PM`}
                            </td>
                            {weekDates.map((d, colIdx) => {
                              const dateStr = toLocalDateString(d)
                              const block = weekSchedules.find((s) => {
                                if (s.date !== dateStr) return false
                                const startH = parseStartHour(s.start_time ?? '00:00')
                                const endExcl = parseEndHourExclusive(s.end_time ?? '00:00') || startH + 1
                                return startH === hour && endExcl > startH
                              })
                              const spanning = weekSchedules.some((s) => {
                                if (s.date !== dateStr) return false
                                const startH = parseStartHour(s.start_time ?? '00:00')
                                const endExcl = parseEndHourExclusive(s.end_time ?? '00:00') || startH + 1
                                return startH < hour && endExcl > hour
                              })
                              if (spanning) return null
                              if (block) {
                                const startParts = (block.start_time ?? '0:0').split(':').slice(0, 2).map(Number)
                                const endParts = (block.end_time ?? '0:0').split(':').slice(0, 2).map(Number)
                                const sh = startParts[0] || 0
                                const sm = startParts[1] || 0
                                const eh = endParts[0] || 0
                                const em = endParts[1] || 0
                                const durationMins = Math.max(0, (eh * 60 + em) - (sh * 60 + sm))
                                const durationHours = Math.ceil(durationMins / 60) || 1
                                const rowSpan = Math.max(1, durationHours)
                                const endHourExclusive = sh + durationHours
                                return (
                                  <td
                                    key={dateStr}
                                    rowSpan={rowSpan}
                                    className="border-b border-r border-gray-200 p-0 align-top last:border-r-0 relative"
                                    style={{ height: `${rowSpan * 3}rem`, verticalAlign: 'top' }}
                                  >
                                    {(() => {
                                      const missed = block.status === 'missed'
                                      const colors = missed
                                        ? { bg: '#f5e6d3', border: '#a8701d', text: '#5c4a2a' }
                                        : getScheduleBlockColors(block.type)
                                      return (
                                        <button
                                          type="button"
                                          onClick={() => openEditVisitModal(block)}
                                          onMouseEnter={() => setScheduleHover({ dateStr, startHour: sh, endHourExclusive })}
                                          onMouseLeave={() => setScheduleHover(null)}
                                          className="w-full flex flex-col rounded border-l-4 p-2 text-left focus:outline-none focus:ring-2 box-border"
                                          style={{
                                            backgroundColor: colors.bg,
                                            borderLeftColor: colors.border,
                                            color: colors.text,
                                            height: '100%',
                                            minHeight: '100%',
                                          }}
                                        >
                                          <div className="min-w-0 flex-1 flex flex-col">
                                            <div className="font-medium">
                                              {block.start_time?.slice(0, 5)} - {block.end_time?.slice(0, 5)}
                                            </div>
                                            <div className="text-xs" style={{ color: colors.text }}>
                                              {block.type || 'Routine'}
                                            </div>
                                            <div className="mt-0.5 flex items-center gap-1 text-xs opacity-90" style={{ color: colors.text }}>
                                              <Clock className="w-3 h-3" />
                                              {durationMins >= 60 ? `${Math.floor(durationMins / 60)}h` : `${durationMins}m`}
                                            </div>
                                          </div>
                                        </button>
                                      )
                                    })()}
                                  </td>
                                )
                              }
                              return (
                                <td
                                  key={dateStr}
                                  className="border-b border-r border-gray-200 p-0 text-center last:border-r-0"
                                  style={{ height: '3rem' }}
                                />
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {scheduleLoading && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/80">
                    <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'adls' && (
            <div className="w-full space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">
                    Activities of Daily Living ({localAdls.length})
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">Manage client care tasks and schedules.</p>
                </div>
                <button
                  type="button"
                  onClick={openAddAdlModal}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  ADD ADL
                </button>
              </div>

              {adlPlanError && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-lg text-sm">
                  {adlPlanError}
                </div>
              )}

              <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                {localAdls.length === 0 ? (
                  <div className="p-12 flex flex-col items-center justify-center text-center">
                    <ClipboardList className="w-12 h-12 text-gray-300 mb-4" aria-hidden />
                    <p className="text-gray-700 font-medium mb-1">No ADL tasks added yet</p>
                    <p className="text-sm text-gray-500 mb-0">Click &quot;ADD ADL&quot; to get started.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-600">
                          <th className="px-4 py-3 bg-gray-50">Name</th>
                          {ADL_DAYS.map((d) => (
                            <th key={d.value} className="px-2 py-3 text-center bg-gray-50">
                              {d.label}
                            </th>
                          ))}
                          <th className="px-2 py-3 text-center w-14 bg-gray-100 text-gray-800 font-medium">
                            ALL
                          </th>
                          <th className="px-2 py-3 text-center w-14 bg-gray-50">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {localAdls.map((adlRow) => {
                          const adlInfo = ADL_LISTS.find((a) => a.name === adlRow.adl_code) ?? { name: adlRow.adl_code, group: 'General' }
                          const adlNote = getAdlNote(adlRow.adl_code)
                          return (
                            <tr key={adlRow.id} className="bg-white hover:bg-gray-50">
                              <td className="px-4 py-3 w-[15rem] max-w-full">
                                <div className="font-semibold text-gray-900">{adlInfo.name}</div>
                                <div className={`text-xs text-gray-500 py-1 px-2 rounded-full w-[3rem] flex justify-center items-center ${adlInfo.group === 'ADL' ? 'bg-blue-500 text-white' : 'bg-red-500 text-white'}`}>{adlInfo.group}</div>
                                <div className="mt-2">
                                  {adlNote ? (
                                    <div className="w-[240px] max-w-full rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="flex min-w-0 items-start gap-1.5">
                                          <FileText className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                                          <p className="leading-snug break-words">{adlNote}</p>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => openAdlNoteModal(adlInfo)}
                                          className="p-0.5 text-amber-500 hover:text-amber-700 rounded"
                                          aria-label={`Edit note for ${adlInfo.name}`}
                                        >
                                          <Edit className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => openAdlNoteModal(adlInfo)}
                                      className="text-xs text-amber-700 hover:text-amber-900 inline-flex items-center gap-1"
                                    >
                                      <FileText className="h-3 w-3" />
                                      Add client note...
                                    </button>
                                  )}
                                </div>
                              </td>
                              {ADL_DAYS.map((d) => {
                                const s = getSchedule(adlRow.adl_code, d.value)
                                const summary = formatAdlDaySummary(s)
                                const specificSlots = getSpecificTimesSlots(s)
                                const type = s?.schedule_type ?? 'never'
                                return (
                                  <td key={d.value} className="px-2 py-3 text-left align-center">
                                    <button
                                      type="button"
                                      onClick={() => openSelectTimeModal(adlInfo, d.value, DAY_LABELS[d.value])}
                                      className="inline-flex flex-row items-start gap-1.5 p-1 rounded hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 min-w-0"
                                      aria-label={`Set schedule for ${adlInfo.name} on ${d.label}`}
                                    >
                                      {type === 'never' && (
                                        <span className="w-6 h-6 rounded-full border-2 border-gray-300 bg-white inline-block shrink-0" />
                                      )}
                                      {type === 'always' && (
                                        <span className="w-6 h-6 rounded-full bg-blue-600 text-white inline-flex items-center justify-center shrink-0">
                                          <Infinity className="w-3.5 h-3.5" />
                                        </span>
                                      )}
                                      {type === 'as_needed' && (
                                        <span className="w-6 h-6 rounded-full bg-blue-600 text-white inline-flex items-center justify-center text-xs font-bold shrink-0">
                                          *
                                        </span>
                                      )}
                                      {type === 'specific_times' && (
                                        <>
                                          <span className="w-6 h-6 rounded-full bg-blue-600 text-white inline-flex items-center justify-center shrink-0">
                                            <Check className="w-3.5 h-3.5" />
                                          </span>
                                          {specificSlots && (
                                            <div className="flex flex-col items-start text-[10px] text-gray-600 leading-tight text-left">
                                              {specificSlots.labels.map((label) => (
                                                <span key={label}>{label}</span>
                                              ))}
                                              <span className="text-blue-600 font-medium mt-0.5">{specificSlots.timesPerDay}x</span>
                                            </div>
                                          )}
                                        </>
                                      )}
                                      {summary && !specificSlots && (
                                        <span className="text-[10px] text-gray-600 leading-tight block">
                                          {summary}
                                        </span>
                                      )}
                                    </button>
                                  </td>
                                )
                              })}
                              <td className="px-2 py-3 text-center align-middle border-l border-gray-200 bg-gray-100">
                                <button
                                  type="button"
                                  onClick={() => handleToggleAdlRowAll(adlRow)}
                                  className={`inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                                    isAdlRowAllSelected(adlRow.adl_code)
                                      ? 'bg-blue-600'
                                      : 'bg-gray-300'
                                  }`}
                                  aria-label={isAdlRowAllSelected(adlRow.adl_code) ? `Unselect all days for ${adlInfo.name}` : `Select all days (morning 1x) for ${adlInfo.name}`}
                                >
                                  <span
                                    className={`w-3 h-3 rounded-full border-2 ${
                                      isAdlRowAllSelected(adlRow.adl_code)
                                        ? 'border-white bg-white'
                                        : 'border-gray-400 bg-white/80'
                                    }`}
                                  />
                                </button>
                              </td>
                              <td className="px-2 py-3 text-center align-middle">
                                <button
                                  type="button"
                                  onClick={() => { void handleAttemptRemoveAdlFromPlan(adlRow.adl_code) }}
                                  className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors inline-flex items-center justify-center"
                                  aria-label={`Remove ${adlInfo.name}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* <div className="border border-gray-200 rounded-lg bg-white px-4 py-3">
                <p className="text-xs font-semibold text-gray-700 mb-2">Legend:</p>
                <div className="flex flex-wrap gap-4">
                  <span className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-gray-400 bg-white" aria-hidden />
                    <span className="text-xs text-gray-600">Never</span>
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-blue-600 text-white inline-flex items-center justify-center">
                      <Infinity className="w-3 h-3" />
                    </span>
                    <span className="text-xs text-gray-600">Always</span>
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-blue-600 text-white inline-flex items-center justify-center text-[10px] font-bold">*</span>
                    <span className="text-xs text-gray-600">As Needed</span>
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-blue-600 text-white inline-flex items-center justify-center">
                      <Check className="w-3 h-3" />
                    </span>
                    <span className="text-xs text-gray-600">Specific Times</span>
                  </span>
                </div>
              </div> */}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setLocalAdls(initialAdls ?? [])
                    setLocalAdlSchedules(initialAdlSchedules ?? [])
                    setPendingAdlDeletes([])
                    setAdlPlanError(null)
                    router.refresh()
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveAdlPlan}
                  disabled={isSavingAdlPlan || !hasAdlPlanChanges}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
                >
                  {isSavingAdlPlan && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save ADL Plan
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Representative Add/Edit Modal */}
      <Modal
        isOpen={repModalOpen}
        onClose={closeRepModal}
        title={repModalMode === 'add' ? `Add Representative #${repModalSlot}` : `Edit Representative #${repModalSlot}`}
        size="md"
      >
        <form onSubmit={handleSaveRep} className="space-y-4">
          {repFormError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {repFormError}
            </div>
          )}
          <div>
            <label htmlFor="rep-name" className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="rep-name"
              type="text"
              value={repForm.name}
              onChange={(e) => setRepForm((p) => ({ ...p, name: e.target.value }))}
              className="block w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isSavingRep}
            />
          </div>
          <div>
            <label htmlFor="rep-relationship" className="block text-sm font-medium text-gray-700 mb-1">
              Relationship
            </label>
            <input
              id="rep-relationship"
              type="text"
              value={repForm.relationship}
              onChange={(e) => setRepForm((p) => ({ ...p, relationship: e.target.value }))}
              className="block w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isSavingRep}
              placeholder="e.g. Wife, Son"
            />
          </div>
          <div>
            <label htmlFor="rep-phone" className="block text-sm font-medium text-gray-700 mb-1">
              Phone Number
            </label>
            <input
              id="rep-phone"
              type="tel"
              value={repForm.phone_number}
              onChange={(e) => setRepForm((p) => ({ ...p, phone_number: e.target.value }))}
              className="block w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isSavingRep}
              placeholder="e.g. (713) 555-0235"
            />
          </div>
          <div>
            <label htmlFor="rep-email" className="block text-sm font-medium text-gray-700 mb-1">
              Email Address
            </label>
            <input
              id="rep-email"
              type="email"
              value={repForm.email_address}
              onChange={(e) => setRepForm((p) => ({ ...p, email_address: e.target.value }))}
              className="block w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isSavingRep}
              placeholder="e.g. linda.c@email.com"
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={closeRepModal}
              disabled={isSavingRep}
              className="px-4 py-2 text-gray-700 font-medium rounded-lg hover:bg-gray-100 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSavingRep}
              className="px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {isSavingRep ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation (Representative, ADL, or Document) */}
      <Modal
        isOpen={!!repToDelete || !!adlToDelete || !!docToDelete}
        onClose={() => {
          setRepToDelete(null)
          setAdlToDelete(null)
          setDocToDelete(null)
        }}
        title={repToDelete ? 'Delete Representative?' : adlToDelete ? 'Remove ADL?' : docToDelete ? 'Delete Document?' : ''}
        size="sm"
      >
        <div className="space-y-4">
          {repToDelete ? (
            <p className="text-gray-600">
              Are you sure you want to remove{' '}
              <strong>{(repToDelete.name && repToDelete.name.trim()) || 'this representative'}</strong>
              {' '}as a representative? This cannot be undone.
            </p>
          ) : adlToDelete ? (
            <p className="text-gray-600">
              Are you sure you want to remove{' '}
              <strong>{ADL_LISTS.find((a) => a.name === adlToDelete)?.name ?? adlToDelete}</strong>
              {' '}from this client&apos;s ADL plan? This cannot be undone.
            </p>
          ) : docToDelete ? (
            <p className="text-gray-600">
              Are you sure you want to delete the document{' '}
              <strong>{docToDelete.name || 'this file'}</strong>
              ? This cannot be undone.
            </p>
          ) : null}
          {(repToDelete && repListError) || (adlToDelete && adlPlanError) || (docToDelete && documentUploadError) ? (
            <p className="text-sm text-red-600 bg-red-50 p-2 rounded-lg">
              {repToDelete ? repListError : adlToDelete ? adlPlanError : documentUploadError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setRepToDelete(null)
                setAdlToDelete(null)
                setDocToDelete(null)
              }}
              className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (repToDelete) {
                  handleDeleteRep()
                } else if (adlToDelete) {
                  handleDeleteAdl(adlToDelete)
                } else if (docToDelete) {
                  handleDeleteDocument(docToDelete)
                }
              }}
              disabled={(!!repToDelete && deletingRepId === repToDelete.id) || (!!adlToDelete && deletingAdlCode === adlToDelete) || (!!docToDelete && isDeletingDocId === docToDelete.id)}
              className="px-4 py-2 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {(repToDelete && deletingRepId === repToDelete.id) || (adlToDelete && deletingAdlCode === adlToDelete) || (docToDelete && isDeletingDocId === docToDelete.id) ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Caregiver Requirements Modal */}
      <Modal
        isOpen={caregiverReqsModalOpen}
        onClose={closeCaregiverReqsModal}
        title="Required Caregiver Skills"
        size="lg"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-50 rounded-lg shrink-0">
              <Sparkles className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                Required Caregiver Skills — {localClient.full_name}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Select all skills a caregiver must have to be assigned to this client.
              </p>
            </div>
          </div>
          {caregiverReqsError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {caregiverReqsError}
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={caregiverReqsSearch}
              onChange={(e) => setCaregiverReqsSearch(e.target.value)}
              placeholder="Search caregiver skills..."
              className="block w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isSavingCaregiverReqs}
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto space-y-6 pr-2">
            {CAREGIVER_REQUIREMENTS_TYPE_ORDER.map((type) => {
              const skills = (skillsByType[type] ?? []).filter((s) => {
                const q = caregiverReqsSearch.trim().toLowerCase()
                if (!q) return true
                return s.name.toLowerCase().includes(q) || s.type.toLowerCase().includes(q)
              })
              if (!skills?.length) return null
              const selectedCount = skills.filter((s) => caregiverReqsSelection.includes(s.name)).length
              const allSelected = selectedCount > 0 && selectedCount === skills.length
              return (
                <div key={type}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {type.toUpperCase()}
                    </h4>
                    <button
                      type="button"
                      onClick={() => setCategorySkillSelection(skills, !allSelected)}
                      className="text-xs px-2 py-1 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                      disabled={isSavingCaregiverReqs}
                    >
                      {allSelected ? 'Clear All' : 'Select All'}
                    </button>
                  </div>
                  <div ref={caregiverReqsDropdownOpen === type ? caregiverReqsOpenCategoryRef : undefined}>
                    <div className="pl-2 space-y-2">
                      <button
                        type="button"
                        onClick={() => setCaregiverReqsDropdownOpen((prev) => (prev === type ? null : type))}
                        className="w-full inline-flex items-center justify-between gap-3 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 hover:bg-gray-50"
                        disabled={isSavingCaregiverReqs}
                      >
                        <span className="font-medium">
                          {caregiverReqsSelection.filter((n) => skills.some((s) => s.name === n)).length > 0
                            ? `Selected (${caregiverReqsSelection.filter((n) => skills.some((s) => s.name === n)).length})`
                            : `Select skills in ${type}...`}
                        </span>
                        <span className="text-gray-400">{caregiverReqsDropdownOpen === type ? '▲' : '▼'}</span>
                      </button>
                      {caregiverReqsDropdownOpen === type && (
                        <div className="mt-2 rounded-lg border border-gray-200 bg-white shadow-sm max-h-56 overflow-y-auto">
                          {skills.map((s) => {
                            const selected = caregiverReqsSelection.includes(s.name)
                            const colorClass = categoryColors[type] ?? 'ring-gray-400 bg-gray-400 text-white'
                            return (
                              <div
                                key={s.name}
                                className={`px-3 py-2 flex items-center justify-between gap-2 cursor-pointer hover:bg-gray-50 ${
                                  selected ? 'bg-gray-50' : ''
                                }`}
                                onClick={() => {
                                  if (!selected) toggleCaregiverSkill(s.name)
                                }}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    if (!selected) toggleCaregiverSkill(s.name)
                                  }
                                }}
                              >
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-gray-900 truncate">{s.name}</div>
                                </div>
                                {selected ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      toggleCaregiverSkill(s.name)
                                    }}
                                    aria-label={`Remove ${s.name}`}
                                    className={`inline-flex items-center justify-center rounded-full ${colorClass} p-1`}
                                  >
                                    <X className="h-3.5 w-3.5 text-white" />
                                  </button>
                                ) : (
                                  <span className="w-7" />
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3 pl-2">
                      {skills
                        .filter((s) => caregiverReqsSelection.includes(s.name))
                        .map((s) => {
                          const colorClass = categoryColors[type] ?? 'ring-gray-400 bg-gray-400 text-white'
                          return (
                            <button
                              key={s.name}
                              type="button"
                              onClick={() => toggleCaregiverSkill(s.name)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full ring-2 ${colorClass}`}
                            >
                              <span className="w-3.5 h-3.5 rounded-full bg-white/20 flex items-center justify-center text-[10px]">
                                <X className="h-3 w-3 text-white" />
                              </span>
                              {s.name}
                            </button>
                          )
                        })}
                    </div>
                  </div>
                </div>
              )
            })}
            {CAREGIVER_REQUIREMENTS_TYPE_ORDER.every((type) => {
              const q = caregiverReqsSearch.trim().toLowerCase()
              const skills = skillsByType[type] ?? []
              return !skills.some((s) => !q || s.name.toLowerCase().includes(q) || s.type.toLowerCase().includes(q))
            }) && (
              <div className="py-8 text-center text-sm text-gray-500">
                No caregiver skills match your search.
              </div>
            )}
          </div>
          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <p className="text-sm text-gray-500">
              {caregiverReqsSelection.length} skill{caregiverReqsSelection.length !== 1 ? 's' : ''} selected
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={closeCaregiverReqsModal}
                disabled={isSavingCaregiverReqs}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCaregiverReqs}
                disabled={isSavingCaregiverReqs}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
              >
                {isSavingCaregiverReqs ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Save Requirements
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* File Incident Report Modal */}
      <Modal
        isOpen={incidentModalOpen}
        onClose={closeIncidentModal}
        title={`File Incident Report — ${localClient.full_name}`}
        size="md"
      >
        <form onSubmit={handleSaveIncident} className="space-y-4">
          <p className="text-sm text-gray-600">Complete all fields and attach the incident report file.</p>

          <div className="rounded-lg border border-amber-400 bg-[#FFF8E5] px-4 py-3 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden />
            <p className="text-sm text-gray-900">
              <strong>Reminder:</strong> This report must also be stored outside this system in your agency&apos;s compliance records.
            </p>
          </div>

          {incidentFormError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {incidentFormError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="incident-incident_date" className="block text-sm font-bold text-gray-700 mb-1">
                Incident Date <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="incident-incident_date"
                  type="date"
                  value={incidentForm.incident_date}
                  onChange={(e) => setIncidentForm((p) => ({ ...p, incident_date: e.target.value }))}
                  className="block w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={isSavingIncident}
                />
                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label htmlFor="incident-reporting_date" className="block text-sm font-bold text-gray-700 mb-1">
                Reporting Date <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="incident-reporting_date"
                  type="date"
                  value={incidentForm.reporting_date}
                  onChange={(e) => setIncidentForm((p) => ({ ...p, reporting_date: e.target.value }))}
                  className="block w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={isSavingIncident}
                />
                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="incident-primary_contact" className="block text-sm font-bold text-gray-700 mb-1">
              Primary Contact Person <span className="text-red-500">*</span>
            </label>
            <input
              id="incident-primary_contact"
              type="text"
              value={incidentForm.primary_contact_person}
              onChange={(e) => setIncidentForm((p) => ({ ...p, primary_contact_person: e.target.value }))}
              className="block w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isSavingIncident}
              placeholder="Full name of primary contact for this incident"
            />
          </div>

          <div>
            <label htmlFor="incident-description" className="block text-sm font-bold text-gray-700 mb-1">
              Description of Incident <span className="text-red-500">*</span>
            </label>
            <textarea
              id="incident-description"
              rows={4}
              value={incidentForm.description}
              onChange={(e) => setIncidentForm((p) => ({ ...p, description: e.target.value }))}
              className="block w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isSavingIncident}
              placeholder="Describe what occurred, when, where, and who was involved..."
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">
              Attach Incident Report File <span className="text-red-500">*</span>
            </label>
            <input
              ref={incidentFileInputRef}
              type="file"
              accept={ACCEPTED_INCIDENT_FILE_TYPES}
              onChange={(e) => {
                const file = e.target.files?.[0]
                setIncidentFormFile(file ?? null)
              }}
              className="hidden"
            />
            {!incidentFormFile ? (
              <button
                type="button"
                onClick={() => incidentFileInputRef.current?.click()}
                disabled={isSavingIncident}
                className="w-full rounded-lg border-2 border-dashed border-gray-300 bg-gray-50/50 py-6 flex flex-col items-center justify-center gap-2 text-gray-500 hover:border-gray-400 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <Upload className="w-8 h-8" />
                <span>Click to upload</span>
                <span className="text-xs">PDF, DOC, DOCX, PNG, JPG</span>
              </button>
            ) : (
              <div className="rounded-lg border-2 border-dashed border-green-400 bg-green-50/30 py-3 px-4 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-5 h-5 text-green-600 shrink-0" />
                  <span className="text-sm font-medium text-gray-900 truncate">{incidentFormFile.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIncidentFormFile(null)
                    if (incidentFileInputRef.current) incidentFileInputRef.current.value = ''
                  }}
                  disabled={isSavingIncident}
                  className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                  aria-label="Remove file"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={closeIncidentModal}
              disabled={isSavingIncident}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSavingIncident}
              className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-50"
            >
              {isSavingIncident ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
              Submit Report
            </button>
          </div>
        </form>
      </Modal>

      {/* Add ADL Task Modal */}
      <Modal
        isOpen={addAdlModalOpen}
        onClose={closeAddAdlModal}
        title="Add ADL Task"
        size="md"
      >
        <form onSubmit={handleSaveAddAdl} className="space-y-4">
          <p className="text-sm text-gray-600">Search and select from the library of daily living activities</p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={addAdlSearch}
              onChange={(e) => setAddAdlSearch(e.target.value)}
              placeholder="Type to search..."
              className="block w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
            {(() => {
              const query = addAdlSearch.toLowerCase().trim()
              const available = ADL_LISTS.filter(
                (a) =>
                  !localAdls.some((x) => x.adl_code === a.name) &&
                  (query === '' ||
                    a.name.toLowerCase().includes(query) ||
                    a.group.toLowerCase().includes(query))
              )
              if (available.length === 0) {
                return (
                  <div className="px-4 py-6 text-center text-sm text-gray-500">
                    No ADLs to add. Already added or no match.
                  </div>
                )
              }
              const grouped = available.reduce<Record<string, typeof available>>((acc, item) => {
                if (!acc[item.group]) acc[item.group] = []
                acc[item.group].push(item)
                return acc
              }, {})
              return Object.keys(grouped).sort().map((groupName) => (
                <div key={groupName} className="border-b border-gray-100 last:border-0">
                  <div className={`text-lg italic py-2 px-2 ${groupName === 'ADL' ? 'text-blue-500' : 'text-red-500'}`}>
                    {groupName === 'ADL' ? 'ADL' : 'IADL'}
                  </div>
                  {grouped[groupName].map((a) => (
                    <label
                      key={a.name}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer border-t border-gray-100 first:border-t-0"
                    >
                      <input
                        type="checkbox"
                        checked={addAdlSelected.has(a.name)}
                        onChange={(e) => {
                          setAddAdlSelected((prev) => {
                            const next = new Set(prev)
                            if (e.target.checked) next.add(a.name)
                            else next.delete(a.name)
                            return next
                          })
                        }}
                        className="mt-1 rounded border-gray-300 text-gray-900 focus:ring-blue-500"
                      />
                      <div className='relative w-full flex items-center'>
                        <div className="text-lg text-gray-900 w-[80%] truncate">{a.name}</div>
                        <div className={`absolute right-2 top-0 mt-1 text-xs text-gray-500 py-0.5 px-2 rounded-full w-[3rem] flex justify-center items-center ${a.group === 'ADL' ? 'bg-blue-500 text-white' : 'bg-red-500 text-white'}`}>{a.group}</div>
                      </div>
                    </label>
                  ))}
                </div>
              ))
            })()}
          </div>
          {addAdlError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {addAdlError}
            </div>
          )}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={closeAddAdlModal}
              disabled={isSavingAddAdl}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSavingAddAdl || addAdlSelected.size === 0}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
            >
              {isSavingAddAdl && <Loader2 className="w-4 h-4 animate-spin" />}
              Save
            </button>
          </div>
        </form>
      </Modal>

      {/* Select Time Modal — no Frequency section; times per day 1–4 */}
      <Modal
        isOpen={selectTimeModalOpen}
        onClose={closeSelectTimeModal}
        title="Select Time"
        size="md"
      >
        <form onSubmit={handleDoneSelectTime} className="space-y-4">
          {selectTimeAdl && (
            <p className="text-sm text-gray-600">
              Choose when this task should happen on {selectTimeDayLabel}
            </p>
          )}
          
          <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-800">Times per Day</label>
                <p className="mt-1 text-xs text-gray-500">How many times this task should be performed on {selectTimeDayLabel}</p>
              </div>
              <select
                value={selectTimeForm.timesPerDay}
                onChange={(e) => {
                  const next = Number(e.target.value) as 1 | 2 | 3 | 4
                  setSelectTimeForm((p) => {
                    const count = [p.morning, p.afternoon, p.evening, p.night].filter(Boolean).length
                    if (count <= next) return { ...p, timesPerDay: next }
                    const updated = { ...p, timesPerDay: next }
                    const order: ('night' | 'evening' | 'afternoon' | 'morning')[] = ['night', 'evening', 'afternoon', 'morning']
                    let toUncheck = count - next
                    for (const k of order) {
                      if (toUncheck > 0 && updated[k]) {
                        updated[k] = false
                        toUncheck--
                      }
                    }
                    return updated
                  })
                }}
                className="shrink-0 rounded border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer"
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-2 text-xs font-medium text-gray-500">OR SELECT SPECIFIC TIME</span>
            </div>
          </div>
          <div>
            <p className="text-sm font-bold text-gray-700 mb-2">Specific Times (select up to {selectTimeForm.timesPerDay})</p>
            <div className="space-y-2">
              {[
                { key: 'morning' as const, label: 'Morning', range: '6 AM - 12 PM', slotKey: 'slotMorning' as const },
                { key: 'afternoon' as const, label: 'Afternoon', range: '12 PM - 6 PM', slotKey: 'slotAfternoon' as const },
                { key: 'evening' as const, label: 'Evening', range: '6 PM - 10 PM', slotKey: 'slotEvening' as const },
                { key: 'night' as const, label: 'Night', range: '10 PM - 5 AM', slotKey: 'slotNight' as const },
              ].map(({ key, label, range, slotKey }) => {
                const selectedCount = [selectTimeForm.morning, selectTimeForm.afternoon, selectTimeForm.evening, selectTimeForm.night].filter(Boolean).length
                const atLimit = selectedCount >= selectTimeForm.timesPerDay
                const canCheck = !selectTimeForm[key] && atLimit ? false : true
                const toggleSlot = () => {
                  if (selectTimeForm[key]) {
                    setSelectTimeForm((p) => ({ ...p, [key]: false }))
                  } else {
                    if (atLimit) return
                    setSelectTimeForm((p) => ({ ...p, [key]: true }))
                  }
                }
                return (
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  onClick={toggleSlot}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSlot() } }}
                  className="flex items-center gap-3 p-3 rounded-lg bg-blue-50/50 border border-blue-100 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectTimeForm[key]}
                    onChange={(e) => {
                      const checked = e.target.checked
                      setSelectTimeForm((p) => {
                        if (checked) {
                          const n = [p.morning, p.afternoon, p.evening, p.night].filter(Boolean).length
                          if (n >= p.timesPerDay) return p
                        }
                        return { ...p, [key]: checked }
                      })
                    }}
                    onClick={(e) => e.stopPropagation()}
                    disabled={canCheck === false}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50 pointer-events-none"
                  />
                  <div className="flex-1 pointer-events-none">
                    <span className="font-medium text-gray-900">{label}</span>
                    <span className="text-sm text-gray-500 ml-2">{range}</span>
                  </div>
                  <select
                    value={selectTimeForm[slotKey]}
                    onChange={(e) => setSelectTimeForm((p) => ({ ...p, [slotKey]: e.target.value as 'always' | 'as_needed' }))}
                    onClick={(e) => e.stopPropagation()}
                    className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    disabled={!selectTimeForm[key]}
                  >
                    <option value="always">Always</option>
                    <option value="as_needed">As Needed</option>
                  </select>
                </div>
                )
              })}
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 flex items-center gap-2"
            >
              Done
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={adlNoteModalOpen}
        onClose={closeAdlNoteModal}
        title={`Note — ${adlNoteTarget?.name ?? ''}`}
        subtitle="Add client-specific instructions for this ADL. Caregivers will see this note during the visit."
        size="md"
      >
        <form onSubmit={handleSaveAdlNote} className="space-y-4">
          <textarea
            value={adlNoteDraft}
            onChange={(e) => setAdlNoteDraft(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
            placeholder="Add note for caregivers..."
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeAdlNoteModal}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRemoveAdlNote}
              className="px-4 py-2 text-sm font-medium text-red-500 hover:text-red-600"
            >
              Remove
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-800"
            >
              Save Note
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Visit Modal */}
      <Modal
        isOpen={addVisitModalOpen}
        onClose={closeAddVisitModal}
        title="Add Visit"
        subtitle={`Add a new visit for ${localClient.full_name}.`}
        headerAccessory={visitModalHeaderTabs}
        size="lg"
      >
        {addVisitTab === 'details' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date {!visitForm.isRecurring && '*'}</label>
                <input
                  type="date"
                  value={visitForm.date}
                  onChange={(e) => setVisitForm((p) => ({ ...p, date: e.target.value }))}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                  disabled={isSavingVisit || visitForm.isRecurring}
                />
                {visitForm.isRecurring && (
                  <p className="mt-1 text-xs text-gray-500">Ignored when Recurring is on. Use Start/End Date in Recurring section.</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Time *</label>
                <input
                  type="time"
                  value={visitForm.startTime}
                  onChange={(e) => setVisitForm((p) => ({ ...p, startTime: e.target.value }))}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  disabled={isSavingVisit}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Time *</label>
                <input
                  type="time"
                  value={visitForm.endTime}
                  onChange={(e) => setVisitForm((p) => ({ ...p, endTime: e.target.value }))}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  disabled={isSavingVisit}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={visitForm.description}
                onChange={(e) => setVisitForm((p) => ({ ...p, description: e.target.value }))}
                rows={2}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                placeholder="Optional"
                disabled={isSavingVisit}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={visitForm.type}
                  onChange={(e) => setVisitForm((p) => ({ ...p, type: e.target.value }))}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm bg-white"
                  disabled={isSavingVisit}
                >
                  {VISIT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Caregiver</label>
                {renderCaregiverPicker()}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={visitForm.notes}
                onChange={(e) => setVisitForm((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                placeholder="Optional"
                disabled={isSavingVisit}
              />
            </div>
            {/* Recurring — toggle only (top box) */}
            <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="block text-sm font-semibold text-gray-900">Recurring</span>
                  <span className="text-xs text-blue-600">Repeat this visit on a schedule</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={visitForm.isRecurring}
                  onClick={() => setVisitForm((p) => ({ ...p, isRecurring: !p.isRecurring }))}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors ${visitForm.isRecurring ? 'bg-gray-900 border-gray-900' : 'bg-gray-200 border-gray-300'}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white border shadow transition-transform ${visitForm.isRecurring ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
            {/* Recurring configuration (bottom box) */}
            {visitForm.isRecurring && (
              <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Repeat Frequency</label>
                  <select
                    value={visitForm.repeatFrequency}
                    onChange={(e) => {
                      const v = e.target.value
                      setVisitForm((p) => {
                        const next = { ...p, repeatFrequency: v }
                        if (v === 'daily') {
                          const today = toLocalDateString(new Date())
                          next.repeatStart = today
                          next.repeatEnd = today
                        } else if (v === 'weekly') {
                          const mon = getMonday(new Date())
                          const sun = getSundayFromMonday(mon)
                          next.repeatStart = toLocalDateString(mon)
                          next.repeatEnd = toLocalDateString(sun)
                        } 
                        // else if (v === 'monthly') {
                        //   const d = new Date()
                        //   const y = d.getFullYear()
                        //   const m = d.getMonth()
                        //   next.repeatStart = `${y}-${String(m + 1).padStart(2, '0')}-01`
                        //   const lastDay = new Date(y, m + 1, 0).getDate()
                        //   next.repeatEnd = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
                        // }
                        return next
                      })
                    }}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                  >
                    <option value="">Select...</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    {/* <option value="monthly">Monthly</option> */}
                  </select>
                </div>
                {visitForm.repeatFrequency === 'weekly' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Days of the Week</label>
                    <div className="flex flex-wrap gap-2">
                      {VISIT_WEEKLY_REPEAT_DAYS_ORDER.map(({ getDay: d, label }) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => {
                            const has = visitForm.repeatDays.includes(d)
                            setVisitForm((p) => ({
                              ...p,
                              repeatDays: has ? p.repeatDays.filter((x) => x !== d) : [...p.repeatDays, d],
                            }))
                          }}
                          className={`min-w-[2.5rem] h-10 rounded-full text-sm font-medium border transition-colors ${visitForm.repeatDays.includes(d) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {visitForm.repeatFrequency === 'monthly' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Repeat on (week + day)</label>
                    <div className="space-y-2">
                      {(visitForm.repeatMonthlyRules.length === 0 ? [{ ordinal: null, weekday: null }] : visitForm.repeatMonthlyRules).map((rule, i) => (
                        <div key={i} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <select
                            value={rule.ordinal ?? ''}
                            onChange={(e) => {
                              const v = e.target.value
                              const ord = v === '' ? null : Number(v)
                              setVisitForm((p) => {
                                const rules = [...(p.repeatMonthlyRules.length === 0 ? [{ ordinal: null as number | null, weekday: null as number | null }] : p.repeatMonthlyRules)]
                                rules[i] = { ...rules[i], ordinal: ord }
                                const isLast = i === rules.length - 1
                                if (isLast && ord != null && rules[i].weekday != null && rules.length > 0) rules.push({ ordinal: null, weekday: null })
                                return { ...p, repeatMonthlyRules: rules }
                              })
                            }}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 min-w-[120px]"
                          >
                            <option value="">Week...</option>
                            <option value={0}>All Weeks</option>
                            {([1, 2, 3, 4, 5] as const).map((ord) => (
                              <option key={ord} value={ord}>{MONTHLY_ORDINAL_LABELS[ord - 1]}</option>
                            ))}
                          </select>
                          <select
                            value={rule.weekday ?? ''}
                            onChange={(e) => {
                              const v = e.target.value
                              const wd = v === '' ? null : Number(v)
                              setVisitForm((p) => {
                                const rules = [...(p.repeatMonthlyRules.length === 0 ? [{ ordinal: null as number | null, weekday: null as number | null }] : p.repeatMonthlyRules)]
                                rules[i] = { ...rules[i], weekday: wd }
                                const isLast = i === rules.length - 1
                                if (isLast && wd != null && rules[i].ordinal != null) rules.push({ ordinal: null, weekday: null })
                                return { ...p, repeatMonthlyRules: rules }
                              })
                            }}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 min-w-[120px]"
                          >
                            <option value="">Day Of Week...</option>
                            {WEEKDAY_NAMES.map((name, wd) => (
                              <option key={wd} value={wd}>{name}</option>
                            ))}
                          </select>
                          {rule.ordinal != null && rule.weekday != null && (
                            <button
                              type="button"
                              onClick={() => {
                                setVisitForm((p) => {
                                  const rules = p.repeatMonthlyRules.filter((_, idx) => idx !== i)
                                  return { ...p, repeatMonthlyRules: rules.length === 0 ? [{ ordinal: null, weekday: null }] : rules }
                                })
                              }}
                              className="text-gray-400 hover:text-red-600 p-1"
                              aria-label="Remove"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                    <div className="relative">
                      <input
                        type="date"
                        value={visitForm.repeatStart}
                        onChange={(e) => setVisitForm((p) => ({ ...p, repeatStart: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-9 text-sm"
                      />
                      <Calendar className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      End Date <span className="text-gray-500 font-normal">(optional)</span>
                    </label>
                    <div className="relative">
                      <input
                        type="date"
                        value={visitForm.repeatEnd}
                        onChange={(e) => setVisitForm((p) => ({ ...p, repeatEnd: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-9 text-sm placeholder:text-gray-400"
                        placeholder="mm/dd/yyyy"
                      />
                      <Calendar className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {addVisitTab === 'adls' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-700">
                Select ADL Tasks <span className="text-red-500">*</span>
              </span>
              {visitAdlSelected.size > 0 && (
                <span className="text-green-600 font-medium">✓ {visitAdlSelected.size} tasks selected</span>
              )}
            </div>
            <div className="max-h-160 overflow-y-auto space-y-2 border border-gray-200 rounded-lg p-2">
              {(() => {
                const visitDate = visitForm.isRecurring ? visitForm.repeatStart : visitForm.date
                const dayOfWeekDb = visitDate
                  ? (() => {
                      const d = new Date(visitDate + 'T12:00:00').getDay()
                      return d === 0 ? 7 : d
                    })()
                  : null
                const assignedSlots = buildAssignedVisitAdlSlotSet(visitDateSchedules ?? [], localAdlSchedules)
                return renderVisitAdlSelectionList(dayOfWeekDb, assignedSlots)
              })()}
            </div>
            {(visitForm.isRecurring ? visitForm.repeatStart : visitForm.date) && (
              <p className="text-xs text-gray-500">
                Only showing ADLs that are not already assigned to other visits on{' '}
                {new Date((visitForm.isRecurring ? visitForm.repeatStart : visitForm.date)! + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.
              </p>
            )}
          </div>
        )}

        {visitError && (
          <p className="mt-4 text-sm text-yellow-600 bg-yellow-100 border border-yellow-200 p-2 rounded">{visitError}</p>
        )}
        {scheduleLimitWarning && (
          <p className="mt-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded">{scheduleLimitWarning}</p>
        )}
        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={closeAddVisitModal}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            disabled={isSavingVisit}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAddVisitSubmit}
            disabled={isSavingVisit}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
          >
            {isSavingVisit && <Loader2 className="w-4 h-4 animate-spin" />}
            Add Visit
          </button>
        </div>
      </Modal>

      {/* Edit Visit Modal */}
      <Modal
        isOpen={editVisitModalOpen}
        onClose={closeEditVisitModal}
        title="Edit Visit"
        subtitle={`Edit visit for ${localClient.full_name}.`}
        headerAccessory={visitModalHeaderTabs}
        size="lg"
      >
        {addVisitTab === 'details' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date {!visitForm.isRecurring && '*'}</label>
                <input
                  type="date"
                  value={visitForm.date}
                  onChange={(e) => setVisitForm((p) => ({ ...p, date: e.target.value }))}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                  disabled={isSavingVisit || visitForm.isRecurring}
                />
                {visitForm.isRecurring && (
                  <p className="mt-1 text-xs text-gray-500">Ignored when Recurring is on. Use Start/End Date in Recurring section.</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Time *</label>
                <input
                  type="time"
                  value={visitForm.startTime}
                  onChange={(e) => setVisitForm((p) => ({ ...p, startTime: e.target.value }))}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  disabled={isSavingVisit}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Time *</label>
                <input
                  type="time"
                  value={visitForm.endTime}
                  onChange={(e) => setVisitForm((p) => ({ ...p, endTime: e.target.value }))}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  disabled={isSavingVisit}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={visitForm.description}
                onChange={(e) => setVisitForm((p) => ({ ...p, description: e.target.value }))}
                rows={2}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                placeholder="Optional"
                disabled={isSavingVisit}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={visitForm.type}
                  onChange={(e) => setVisitForm((p) => ({ ...p, type: e.target.value }))}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm bg-white"
                  disabled={isSavingVisit}
                >
                  {VISIT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Caregiver</label>
                {renderCaregiverPicker()}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={visitForm.notes}
                onChange={(e) => setVisitForm((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                placeholder="Optional"
                disabled={isSavingVisit}
              />
            </div>
            {/* Recurring — toggle only (top box) */}
            <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="block text-sm font-semibold text-gray-900">Recurring</span>
                  <span className="text-xs text-blue-600">Repeat this visit on a schedule</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={visitForm.isRecurring}
                  onClick={() => setVisitForm((p) => ({ ...p, isRecurring: !p.isRecurring }))}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors ${visitForm.isRecurring ? 'bg-gray-900 border-gray-900' : 'bg-gray-200 border-gray-300'}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white border shadow transition-transform ${visitForm.isRecurring ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
            {/* Recurring configuration (bottom box) */}
            {visitForm.isRecurring && (
              <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Repeat Frequency</label>
                  <select
                    value={visitForm.repeatFrequency}
                    onChange={(e) => {
                      const v = e.target.value
                      setVisitForm((p) => {
                        const next = { ...p, repeatFrequency: v }
                        if (v === 'daily') {
                          const today = toLocalDateString(new Date())
                          next.repeatStart = today
                          next.repeatEnd = today
                        } else if (v === 'weekly') {
                          const mon = getMonday(new Date())
                          const sun = getSundayFromMonday(mon)
                          next.repeatStart = toLocalDateString(mon)
                          next.repeatEnd = toLocalDateString(sun)
                        } 
                        // else if (v === 'monthly') {
                        //   const d = new Date()
                        //   const y = d.getFullYear()
                        //   const m = d.getMonth()
                        //   next.repeatStart = `${y}-${String(m + 1).padStart(2, '0')}-01`
                        //   const lastDay = new Date(y, m + 1, 0).getDate()
                        //   next.repeatEnd = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
                        // }
                        return next
                      })
                    }}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                  >
                    <option value="">Select...</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    {/* <option value="monthly">Monthly</option> */}
                  </select>
                </div>
                {visitForm.repeatFrequency === 'weekly' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Days of the Week</label>
                    <div className="flex flex-wrap gap-2">
                      {VISIT_WEEKLY_REPEAT_DAYS_ORDER.map(({ getDay: d, label }) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => {
                            const has = visitForm.repeatDays.includes(d)
                            setVisitForm((p) => ({
                              ...p,
                              repeatDays: has ? p.repeatDays.filter((x) => x !== d) : [...p.repeatDays, d],
                            }))
                          }}
                          className={`min-w-[2.5rem] h-10 rounded-full text-sm font-medium border transition-colors ${visitForm.repeatDays.includes(d) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {visitForm.repeatFrequency === 'monthly' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Repeat on (week + day)</label>
                    <div className="space-y-2">
                      {(visitForm.repeatMonthlyRules.length === 0 ? [{ ordinal: null, weekday: null }] : visitForm.repeatMonthlyRules).map((rule, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2">
                          <select
                            value={rule.ordinal ?? ''}
                            onChange={(e) => {
                              const v = e.target.value
                              const ord = v === '' ? null : Number(v)
                              setVisitForm((p) => {
                                const rules = [...(p.repeatMonthlyRules.length === 0 ? [{ ordinal: null as number | null, weekday: null as number | null }] : p.repeatMonthlyRules)]
                                rules[i] = { ...rules[i], ordinal: ord }
                                const isLast = i === rules.length - 1
                                if (isLast && ord != null && rules[i].weekday != null && rules.length > 0) rules.push({ ordinal: null, weekday: null })
                                return { ...p, repeatMonthlyRules: rules }
                              })
                            }}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 min-w-[120px]"
                          >
                            <option value="">Week...</option>
                            <option value={0}>All</option>
                            {([1, 2, 3, 4, 5] as const).map((ord) => (
                              <option key={ord} value={ord}>{MONTHLY_ORDINAL_LABELS[ord - 1]}</option>
                            ))}
                          </select>
                          <select
                            value={rule.weekday ?? ''}
                            onChange={(e) => {
                              const v = e.target.value
                              const wd = v === '' ? null : Number(v)
                              setVisitForm((p) => {
                                const rules = [...(p.repeatMonthlyRules.length === 0 ? [{ ordinal: null as number | null, weekday: null as number | null }] : p.repeatMonthlyRules)]
                                rules[i] = { ...rules[i], weekday: wd }
                                const isLast = i === rules.length - 1
                                if (isLast && wd != null && rules[i].ordinal != null) rules.push({ ordinal: null, weekday: null })
                                return { ...p, repeatMonthlyRules: rules }
                              })
                            }}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 min-w-[120px]"
                          >
                            <option value="">Day...</option>
                            {WEEKDAY_NAMES.map((name, wd) => (
                              <option key={wd} value={wd}>{name}</option>
                            ))}
                          </select>
                          {rule.ordinal != null && rule.weekday != null && (
                            <button
                              type="button"
                              onClick={() => {
                                setVisitForm((p) => {
                                  const rules = p.repeatMonthlyRules.filter((_, idx) => idx !== i)
                                  return { ...p, repeatMonthlyRules: rules.length === 0 ? [{ ordinal: null, weekday: null }] : rules }
                                })
                              }}
                              className="text-gray-400 hover:text-red-600 p-1"
                              aria-label="Remove"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                    <div className="relative">
                      <input
                        type="date"
                        value={visitForm.repeatStart}
                        onChange={(e) => setVisitForm((p) => ({ ...p, repeatStart: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-9 text-sm"
                      />
                      <Calendar className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      End Date <span className="text-gray-500 font-normal">(optional)</span>
                    </label>
                    <div className="relative">
                      <input
                        type="date"
                        value={visitForm.repeatEnd}
                        onChange={(e) => setVisitForm((p) => ({ ...p, repeatEnd: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-9 text-sm placeholder:text-gray-400"
                        placeholder="mm/dd/yyyy"
                      />
                      <Calendar className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {addVisitTab === 'adls' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-700">
                Select ADL Tasks <span className="text-red-500">*</span>
              </span>
              {visitAdlSelected.size > 0 && (
                <span className="text-green-600 font-medium">✓ {visitAdlSelected.size} tasks selected</span>
              )}
            </div>
            <div className="max-h-160 overflow-y-auto space-y-2 border border-gray-200 rounded-lg p-2">
              {(() => {
                const visitDate = visitForm.date
                const dayOfWeekDb = visitDate
                  ? (() => {
                      const d = new Date(visitDate + 'T12:00:00').getDay()
                      return d === 0 ? 7 : d
                    })()
                  : null
                const otherVisitsOnDate = (visitDateSchedules ?? []).filter((s) => s.id !== editingSchedule?.id)
                const assignedSlots = buildAssignedVisitAdlSlotSet(otherVisitsOnDate, localAdlSchedules)
                return renderVisitAdlSelectionList(dayOfWeekDb, assignedSlots)
              })()}
            </div>
            {(visitForm.isRecurring ? visitForm.repeatStart : visitForm.date) && (
              <p className="text-xs text-gray-500">
                Only showing ADLs that are not already assigned to other visits on{' '}
                {new Date((visitForm.isRecurring ? visitForm.repeatStart : visitForm.date)! + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.
              </p>
            )}
          </div>
        )}

        {visitError && (
          <p className="mt-4 text-sm text-yellow-600 bg-yellow-100 border border-yellow-200 p-2 rounded">{visitError}</p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 mt-6">
          {editingSchedule?.status === 'missed' ? (
            <button
              type="button"
              onClick={handleMarkVisitUnmissed}
              disabled={isSavingVisit}
              className="inline-flex items-center gap-1.5 px-4 py-2 border-2 border-[#a8701d] text-[#a8701d] rounded-lg text-sm font-medium hover:bg-[#f5e6d3] disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              Mark as Unmissed
            </button>
          ) : (
            <button
              type="button"
              onClick={handleMarkVisitMissed}
              disabled={isSavingVisit}
              className="inline-flex items-center gap-1.5 px-4 py-2 border-2 border-orange-500 text-orange-600 rounded-lg text-sm font-medium hover:bg-orange-50 disabled:opacity-50"
            >
              <X className="w-4 h-4" />
              Mark as Missed
            </button>
          )}
          <button
            type="button"
            onClick={handleDeleteVisit}
            disabled={isSavingVisit}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            Delete Visit
          </button>
          <button
            type="button"
            onClick={closeEditVisitModal}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            disabled={isSavingVisit}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpdateVisitSubmit}
            disabled={isSavingVisit}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
          >
            {isSavingVisit && <Loader2 className="w-4 h-4 animate-spin" />}
            Update Visit
          </button>
        </div>
      </Modal>

      {/* Manage Contracted Hours Modal */}
      <Modal
        isOpen={manageLimitModalOpen}
        onClose={closeManageLimitModal}
        title={`Manage Contracted Weekly Hours — ${localClient.full_name}`}
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-500 -mt-2">
            Set total contracted caregiver hours. The limit takes effect from the week that contains the effective date.
          </p>
          <div className="rounded-lg border border-gray-200 p-4 space-y-4">
            <h4 className="text-sm font-semibold text-gray-900">Add New Hours Limit</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hours Per Week *</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={limitForm.totalHours}
                  onChange={(e) => setLimitForm((p) => ({ ...p, totalHours: e.target.value }))}
                  placeholder="e.g. 40"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  disabled={isSavingLimit}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Effective Date *</label>
                <input
                  type="date"
                  value={limitForm.effectiveDate}
                  onChange={(e) => setLimitForm((p) => ({ ...p, effectiveDate: e.target.value }))}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  disabled={isSavingLimit}
                />
                <p className="mt-1 text-xs text-gray-500">This will apply from that week&apos;s Monday.</p>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
              <input
                type="text"
                value={limitForm.note}
                onChange={(e) => setLimitForm((p) => ({ ...p, note: e.target.value }))}
                placeholder="e.g. Plan renewal, insurance update..."
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                disabled={isSavingLimit}
              />
            </div>
            <button
              type="button"
              onClick={handleSaveLimit}
              disabled={isSavingLimit}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
            >
              {isSavingLimit && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Hours Limit
            </button>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1 mb-2">
              <Clock className="w-4 h-4" />
              Limit History
            </h4>
            <div className="rounded border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-2 font-medium text-gray-700">Total hrs</th>
                    <th className="text-left p-2 font-medium text-gray-700">Effective Date</th>
                    <th className="text-left p-2 font-medium text-gray-700">Note</th>
                    <th className="text-left p-2 font-medium text-gray-700">Status</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {limitHistoryRows.map((row) => {
                    const isCurrent = currentEffectiveLimit?.id === row.id
                    const rawNote = row.note?.trim() ?? ''
                    const notePreview =
                      rawNote.length === 0
                        ? '—'
                        : rawNote.length > 10
                          ? `${rawNote.slice(0, 10)}…`
                          : rawNote
                    return (
                      <tr key={row.id} className={isCurrent ? 'bg-blue-50' : 'bg-white'}>
                        <td className="p-2">{row.total_hours} hrs</td>
                        <td className="p-2">{formatShortDate(row.effective_date)}</td>
                        <td
                          className="p-2 text-gray-600 max-w-[10rem]"
                          title={rawNote.length > 10 ? rawNote : undefined}
                        >
                          {notePreview}
                        </td>
                        <td className="p-2">
                          {isCurrent
                            ? <span className="text-xs font-medium text-blue-600">Current</span>
                            : <span className="text-xs font-medium text-gray-500">Inactive</span>}
                        </td>
                        <td className="p-2">
                          <button
                            type="button"
                            onClick={() => handleDeleteLimit(row.id)}
                            className="text-gray-400 hover:text-red-600"
                            aria-label="Delete"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {limitHistoryRows.length === 0 && (
              <p className="text-sm text-gray-500 py-4 text-center">No limit history yet.</p>
            )}
          </div>

          {limitError && <p className="text-sm text-red-600">{limitError}</p>}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={closeManageLimitModal}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
