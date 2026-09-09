import type {
  ComplaintDTO,
  DiagnosisDTO,
  DispenseStatus,
  PrescriptionDTO,
  VitalSignsDTO,
} from './patient'

export type OrderType = 'LABORATORY' | 'IMAGING' | 'PROCEDURE'
export type OrderStatus = 'ORDERED' | 'IN_PROGRESS' | 'RESULTED' | 'CANCELLED'
export type AbnormalFlag = 'Normal' | 'Low' | 'High' | 'Critical'

export interface ServiceItemDTO {
  id: string
  name: string
  category: string | null
  unitPrice: string
}

export interface ClinicalNoteDTO {
  id: string
  visitId: string | null
  subjective: string | null
  objective: string | null
  assessment: string | null
  plan: string | null
  authorName: string | null
  updatedAt: string
}

export interface ClinicalOrderDTO {
  id: string
  visitId: string | null
  orderType: OrderType
  name: string
  status: OrderStatus
  priority: string | null
  clinicalNote: string | null
  orderedByName: string | null
  orderedAt: string
  resultValue: string | null
  resultUnit: string | null
  referenceRange: string | null
  abnormalFlag: AbnormalFlag | string | null
  resultNote: string | null
  resultedByName: string | null
  resultedAt: string | null
}

export interface EncounterInvoiceLineDTO {
  id: string
  category: string | null
  description: string
  quantity: number
  unitPrice: string
  lineTotal: string
}

export interface EncounterInvoiceDTO {
  id: string
  invoiceNumber: string
  status: 'UNPAID' | 'PARTIAL' | 'PAID'
  totalAmount: string
  paidAmount: string
  balanceDue: string
  lines: EncounterInvoiceLineDTO[]
}

export interface EncounterPatientSnapshotDTO {
  id: string
  patientNumber: string
  firstName: string
  middleName: string | null
  lastName: string
  age: number | null
  gender: string | null
  bloodGroup: string | null
  genotype: string | null
  allergies: string | null
  chronicConditions: string | null
  currentMedications: string | null
  payerType: string
  hmoName: string | null
}

export interface EncounterVisitDTO {
  id: string
  visitType: string
  status: string
  startsAt: string
  endsAt: string
  reason: string | null
  startedAt: string | null
  completedAt: string | null
  doctor: { id: string; fullName: string } | null
  department: { id: string; name: string } | null
}

export interface EncounterDTO {
  visit: EncounterVisitDTO
  patient: EncounterPatientSnapshotDTO
  lastVitals: VitalSignsDTO | null
  complaints: ComplaintDTO[]
  vitals: VitalSignsDTO[]
  diagnoses: DiagnosisDTO[]
  orders: ClinicalOrderDTO[]
  prescriptions: PrescriptionDTO[]
  note: ClinicalNoteDTO | null
  invoice: EncounterInvoiceDTO | null
}

export interface PharmacyQueueItemDTO {
  id: string
  status: string
  dispenseStatus: DispenseStatus
  notes: string | null
  prescribedAt: string
  prescribedByName: string | null
  visitId: string | null
  patient: {
    id: string
    patientNumber: string
    firstName: string
    lastName: string
  }
  items: {
    id: string
    drugId: string | null
    drugName: string
    dosageForm: string | null
    strengthConc: string | null
    amountPerUse: string | null
    frequency: string | null
    durationType: string | null
    durationNumber: number | null
    dispensedQty: number | null
    dispenseUnitPrice: string | null
    sellPrice: string | null
    quantityOnHand: number | null
  }[]
}
