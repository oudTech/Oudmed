import type { PayerType, VisitPatientDTO } from './schedule'

export type BedStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'MAINTENANCE'
export type WardType =
  | 'GENERAL'
  | 'PRIVATE'
  | 'ICU'
  | 'HDU'
  | 'MATERNITY'
  | 'PEDIATRIC'
  | 'ISOLATION'
export type AdmissionType = 'EMERGENCY' | 'ELECTIVE' | 'TRANSFER' | 'REFERRAL' | 'OBSERVATION'
export type AdmissionStatus =
  | 'ADMITTED'
  | 'DISCHARGED'
  | 'TRANSFERRED_OUT'
  | 'DECEASED'
  | 'ABSCONDED'

export interface BedDTO {
  id: string
  label: string
  status: BedStatus
  wardId: string
}

export interface WardDTO {
  id: string
  name: string
  wardType: WardType
  bedCount: number
  availableBeds: number
}

export interface BoardBedDTO {
  id: string
  label: string
  status: BedStatus
  admission: {
    id: string
    admissionNumber: string
    admissionType: AdmissionType
    admittedAt: string
    patient: { id: string; patientNumber: string; firstName: string; lastName: string }
    attendingDoctor: { id: string; fullName: string } | null
  } | null
}

export interface WardBoardDTO {
  id: string
  name: string
  wardType: WardType
  beds: BoardBedDTO[]
  stats: { total: number; occupied: number; available: number }
}

export interface AdmissionDTO {
  id: string
  admissionNumber: string
  status: AdmissionStatus
  admissionType: AdmissionType
  reason: string | null
  provisionalDiagnosis: string | null
  payerType: PayerType
  hmoName: string | null
  authCode: string | null
  admittedAt: string
  expectedDischargeAt: string | null
  dischargedAt: string | null
  dischargeNotes: string | null
  patient: VisitPatientDTO
  admittingDoctor: { id: string; fullName: string } | null
  attendingDoctor: { id: string; fullName: string } | null
  department: { id: string; name: string } | null
  ward: { id: string; name: string } | null
  bed: { id: string; label: string } | null
}
