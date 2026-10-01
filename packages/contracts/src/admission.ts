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
  dailyRate: string | null
  dayCaseRate: string | null
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
  reopenedAt: string | null
  patient: VisitPatientDTO
  admittingDoctor: { id: string; fullName: string } | null
  attendingDoctor: { id: string; fullName: string } | null
  department: { id: string; name: string } | null
  ward: { id: string; name: string; dailyRate: string | null } | null
  bed: { id: string; label: string } | null
}

export interface AdmissionDepositDTO {
  id: string
  amount: string
  method: string
  reference: string | null
  receiptNumber: string | null
  receivedAt: string
  appliedAmount: string | null
  refundedAmount: string | null
  refundedAt: string | null
  refundReason: string | null
}

export interface AdmissionNoteAddendumDTO {
  id: string
  subjective: string | null
  objective: string | null
  assessment: string | null
  plan: string | null
  authorId: string | null
  authorName: string | null
  createdAt: string
}

/** One dated ward-round note on an admission - unlike a visit's single
 * upsertable note, an admission has many of these over the stay. */
export interface AdmissionNoteDTO {
  id: string
  subjective: string | null
  objective: string | null
  assessment: string | null
  plan: string | null
  authorId: string | null
  authorName: string | null
  createdAt: string
  addenda: AdmissionNoteAddendumDTO[]
}

/** The inpatient workspace read - admission header plus what has been
 * recorded against it so far. */
export interface AdmissionWorkspaceDTO {
  admission: AdmissionDTO
  vitals: Record<string, unknown>[]
  complaints: Record<string, unknown>[]
  diagnoses: Record<string, unknown>[]
  prescriptions: Record<string, unknown>[]
  orders: Record<string, unknown>[]
  notes: AdmissionNoteDTO[]
  deposits: AdmissionDepositDTO[]
  totalDeposited: string
  /** Deposit credit already earmarked as a pending refund - not available
   * to spend against a new charge, and never blocks discharge (F1c). */
  pendingRefund: string | null
}

/** A deposit refund still owed to a patient, not yet paid out - shown on
 * the admission and on the tenant-wide "refunds due" list for billing. */
export interface AdmissionPendingRefundDTO {
  id: string
  amount: string
  reason: string | null
  requestedAt: string
  admissionId: string
  admissionNumber: string
  patient: { id: string; patientNumber: string; name: string }
}

export interface AdmissionBillLineDTO {
  id: string
  category: string | null
  description: string
  quantity: number
  unitPrice: string
  lineTotal: string
}

export interface AdmissionBillInvoiceDTO {
  id: string
  invoiceNumber: string
  status: string
  isSupplementary: boolean
  totalAmount: string
  lineCount: number
  lines: AdmissionBillLineDTO[]
  claim: { id: string; claimNumber: string; status: string } | null
}

export interface AdmissionBillDTO {
  admission: AdmissionDTO
  invoices: AdmissionBillInvoiceDTO[]
  deposits: AdmissionDepositDTO[]
  totalCharged: string
  totalPaid: string
  totalDeposited: string
  pendingRefund: string | null
  balance: string
}

export interface DischargeSummaryDTO {
  admission: AdmissionDTO
  diagnoses: Record<string, unknown>[]
  prescriptions: Record<string, unknown>[]
  notes: Record<string, unknown>[]
  totalCharged: string
  totalPaid: string
  totalDeposited: string
  pendingRefund: string | null
  balance: string
}
