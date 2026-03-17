export interface LicenseType {
  id: string
  name: string
  description: string
  cost: string // cost_display from database
  serviceFee?: string // service_fee_display from database
  processingTime: string // processing_time_display from database
  renewalPeriod: string // renewal_period_display from database
  icon: 'heart' | 'users' // icon_type from database
  requirements: string[] // requirements JSONB from database
  state?: string // state from database
}

