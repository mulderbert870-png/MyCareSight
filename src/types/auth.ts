export type UserRole = 'company_owner' | 'staff_member' | 'admin' | 'expert'

export interface User {
  id: string
  email: string
  full_name?: string
  role: UserRole
  created_at: string
  updated_at: string
}

export interface AuthUser {
  id: string
  email: string
  user_metadata?: {
    full_name?: string
    role?: UserRole
  }
}


