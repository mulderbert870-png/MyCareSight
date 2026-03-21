'use client'

import ModalWrapper from './Modal'
import CaregiverProfileContent from './CaregiverProfileContent'

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
  pay_rate?: string | number | null
  address?: string | null
  state?: string | null
  zip_code?: string | null
  skills?: string[] | null
  created_at?: string
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
  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      title={`Caregiver Profile \u2014 ${staff.first_name} ${staff.last_name}`}
      subtitle="View detailed information about this caregiver, including their certifications, skills, and contact details."
      size="lg"
    >
      <CaregiverProfileContent staff={staff} licenses={licenses} />
    </ModalWrapper>
  )
}
