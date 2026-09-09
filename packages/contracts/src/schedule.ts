export type VisitType = 'CONSULTATION' | 'FOLLOW_UP' | 'WALK_IN' | 'EMERGENCY'
export type VisitStatus =
  | 'SCHEDULED'
  | 'CHECKED_IN'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
export type PayerType = 'CASH' | 'HMO' | 'NHIS' | 'RETAINER'

export interface DepartmentDTO {
  id: string
  name: string
  code: string | null
}

export interface DoctorShiftDTO {
  dayOfWeek: number // 0 = Sunday ... 6 = Saturday
  startMinute: number
  endMinute: number
}

export interface StaffDTO {
  id: string
  fullName: string
  email: string
  role: string
  jobTitle: string | null
  avatarUrl: string | null
  isActive: boolean
  shifts: DoctorShiftDTO[]
}

export interface VisitPatientDTO {
  id: string
  patientNumber: string
  firstName: string
  lastName: string
  phone: string | null
  gender: string | null
  payerType: PayerType
  hmoName: string | null
}

export interface VisitDTO {
  id: string
  status: VisitStatus
  visitType: VisitType
  startsAt: string
  endsAt: string
  reason: string | null
  notes: string | null
  roomLabel: string | null
  payerType: PayerType
  hmoName: string | null
  authCode: string | null
  checkedInAt: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  patient: VisitPatientDTO
  doctor: { id: string; fullName: string; jobTitle: string | null } | null
  department: { id: string; name: string } | null
}
