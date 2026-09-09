import type { HmsRole } from './user'

export type StaffAccountStatus = 'Active' | 'Inactive'

/** Roles a hospital admin can assign from the HR screen (never SUPER_ADMIN). */
export const HR_ROLES: { value: HmsRole; label: string }[] = [
  { value: 'HOSPITAL_ADMIN', label: 'Hospital admin' },
  { value: 'DOCTOR', label: 'Doctor' },
  { value: 'NURSE', label: 'Nurse' },
  { value: 'RECEPTIONIST', label: 'Receptionist' },
  { value: 'PHARMACIST', label: 'Pharmacist' },
  { value: 'LAB_STAFF', label: 'Lab scientist' },
  { value: 'ACCOUNTANT', label: 'Accountant' },
]

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super admin',
  HOSPITAL_ADMIN: 'Hospital admin',
  DOCTOR: 'Doctor',
  NURSE: 'Nurse',
  RECEPTIONIST: 'Receptionist',
  PHARMACIST: 'Pharmacist',
  LAB_STAFF: 'Lab scientist',
  ACCOUNTANT: 'Accountant',
}

export interface StaffDepartmentRefDTO {
  id: string
  name: string
  isPrimary: boolean
}

export interface StaffListItemDTO {
  id: string
  fullName: string
  email: string
  phone: string | null
  role: HmsRole
  jobTitle: string | null
  notes: string | null
  isActive: boolean
  accountStatus: StaffAccountStatus
  lastLoginAt: string | null
  departments: StaffDepartmentRefDTO[]
}

export interface StaffListResponse {
  page: number
  pageSize: number
  total: number
  staff: StaffListItemDTO[]
}

export interface StaffDetailDTO extends StaffListItemDTO {
  createdAt: string
  invitedByName: string | null
  assignedPatientCount: number
  upcomingVisitCount: number
}
