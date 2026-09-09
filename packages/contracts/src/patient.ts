import type { PayerType } from './schedule'

export type MaritalStatus = 'SINGLE' | 'MARRIED' | 'DIVORCED' | 'WIDOWED' | 'SEPARATED'
export type BloodGroup = 'A' | 'B' | 'AB' | 'O'
export type RhFactor = 'POSITIVE' | 'NEGATIVE'
export type Genotype = 'AA' | 'AS' | 'SS' | 'AC' | 'SC' | 'CC'
export type PregnancyStatus = 'NOT_APPLICABLE' | 'NOT_PREGNANT' | 'PREGNANT' | 'UNKNOWN'
export type IdDocumentType =
  | 'NATIONAL_ID'
  | 'DRIVERS_LICENSE'
  | 'PASSPORT'
  | 'VOTERS_CARD'
  | 'NHIS_CARD'
  | 'OTHER'
export type RegistrationStatus = 'INCOMPLETE' | 'COMPLETE'
export type PatientListStatus = 'ACTIVE' | 'INPATIENT' | 'INCOMPLETE'

export type DocumentCategory =
  | 'IDENTIFICATION'
  | 'PHOTO'
  | 'LAB_RESULT'
  | 'IMAGING'
  | 'REFERRAL'
  | 'CONSENT'
  | 'INSURANCE_CARD'
  | 'DISCHARGE_SUMMARY'
  | 'OTHER'
export type ComplaintStatus = 'OPEN' | 'RESOLVED'
export type DiagnosisCertainty =
  | 'PROVISIONAL'
  | 'WORKING'
  | 'DIFFERENTIAL'
  | 'FINAL'
  | 'RULED_OUT'
export type PrescriptionStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED'

/** Row in the patients list. */
export interface PatientListItemDTO {
  id: string
  patientNumber: string
  firstName: string
  middleName: string | null
  lastName: string
  gender: string | null
  phone: string | null
  age: number | null
  payerType: PayerType
  hmoName: string | null
  registrationStatus: RegistrationStatus
  assignedDoctor: { id: string; fullName: string } | null
  lastVisitAt: string | null
  status: PatientListStatus
}

export interface PatientListResponse {
  page: number
  pageSize: number
  total: number
  patients: PatientListItemDTO[]
}

export interface PatientStatDTO {
  total: number
  addedThisMonth: number
}
export interface PatientStatsResponse {
  activePatients: PatientStatDTO
  inpatients: PatientStatDTO
  emergencyCases: PatientStatDTO
  hmoPatients: PatientStatDTO
}

/** Full patient record + computed extras. */
export interface PatientDTO {
  id: string
  patientNumber: string
  firstName: string
  middleName: string | null
  lastName: string
  dateOfBirth: string | null
  gender: string | null
  maritalStatus: MaritalStatus | null
  nationality: string | null
  occupation: string | null
  phone: string | null
  altPhone: string | null
  email: string | null
  address: string | null
  city: string | null
  state: string | null
  country: string | null

  emergencyContactName: string | null
  emergencyContactRelationship: string | null
  emergencyContactPhone: string | null
  emergencyContactAltPhone: string | null
  emergencyContactAddress: string | null

  bloodGroup: BloodGroup | null
  rhFactor: RhFactor | null
  genotype: Genotype | null
  allergies: string | null
  chronicConditions: string | null
  currentMedications: string | null
  previousSurgeries: string | null
  disabilities: string | null
  pregnancyStatus: PregnancyStatus | null
  familyHistory: string | null
  heightCm: number | null
  weightKg: string | null

  historyPresentingComplaint: string | null
  pastMedicalHistory: string | null
  drugHistory: string | null
  reproductiveHistory: string | null
  socialHistory: string | null

  payerType: PayerType
  hmoName: string | null
  hmoNumber: string | null
  insuranceProvider: string | null
  insuranceNumber: string | null
  insurancePlanType: string | null
  insuranceEmployer: string | null
  insuranceExpiry: string | null

  photoUrl: string | null
  idDocumentType: IdDocumentType | null
  idDocumentNumber: string | null

  consentTreatment: boolean
  consentDataProcessing: boolean
  consentGivenAt: string | null

  registrationStatus: RegistrationStatus
  registrationStep: number
  assignedDoctorId: string | null
  assignedDoctor: { id: string; fullName: string; jobTitle: string | null } | null
  isActive: boolean
  createdAt: string

  age: number | null
  status: PatientListStatus
  currentAdmission: {
    id: string
    admissionNumber: string
    ward: string | null
    bed: string | null
    admittedAt: string
  } | null
  counts: {
    appointments: number
    documents: number
    openComplaints: number
    diagnoses: number
    activePrescriptions: number
    outstandingInvoices: number
    outstandingAmount: string
  }
  lastVisitAt: string | null
}

export interface DuplicateMatch {
  id: string
  patientNumber: string
  firstName: string
  middleName: string | null
  lastName: string
  dateOfBirth: string | null
  phone: string | null
  gender: string | null
  age: number | null
}

export interface PatientDocumentDTO {
  id: string
  category: DocumentCategory
  title: string
  fileName: string | null
  mimeType: string | null
  note: string | null
  createdAt: string
}

export interface ComplaintDTO {
  id: string
  description: string
  onsetNote: string | null
  severity: string | null
  status: ComplaintStatus
  visitId: string | null
  recordedByName: string | null
  recordedAt: string
}

export interface DiagnosisDTO {
  id: string
  description: string
  code: string | null
  certainty: DiagnosisCertainty
  attendanceType: string | null
  notes: string | null
  recordedByName: string | null
  diagnosedAt: string
}

export interface VitalSignsDTO {
  id: string
  temperatureC: string | null
  pulseBpm: number | null
  respiratoryRate: number | null
  systolicBp: number | null
  diastolicBp: number | null
  spo2: number | null
  weightKg: string | null
  heightCm: number | null
  bmi: string | null
  bloodGlucose: string | null
  urineOutputMl: number | null
  avpu: string | null
  painScore: number | null
  notes: string | null
  recordedByName: string | null
  recordedAt: string
}

export interface PrescriptionItemDTO {
  id: string
  drugId: string | null
  drugName: string
  dosageForm: string | null
  strengthConc: string | null
  amountPerUse: string | null
  frequency: string | null
  route: string | null
  foodRelation: string | null
  durationType: string | null
  durationNumber: number | null
  instructions: string | null
}
export type DispenseStatus = 'PENDING' | 'PARTIAL' | 'DISPENSED' | 'CANCELLED'

export interface PrescriptionDTO {
  id: string
  status: PrescriptionStatus
  dispenseStatus: DispenseStatus
  notes: string | null
  prescribedByName: string | null
  dispensedByName: string | null
  prescribedAt: string
  items: PrescriptionItemDTO[]
}

/** Row in the patient "Visit history" tab. */
export interface PatientVisitRowDTO {
  id: string
  visitType: string
  status: string
  startsAt: string
  reason: string | null
  doctor: { id: string; fullName: string } | null
  department: { id: string; name: string } | null
  primaryDiagnosis: string | null
  invoice: { id: string; invoiceNumber: string; status: string } | null
  hasNote: boolean
  orderCount: number
}

/** Row in the patient "Investigations" tab. */
export interface PatientOrderRowDTO {
  id: string
  visitId: string | null
  orderType: 'LABORATORY' | 'IMAGING' | 'PROCEDURE'
  name: string
  status: 'ORDERED' | 'IN_PROGRESS' | 'RESULTED' | 'CANCELLED'
  priority: string | null
  orderedByName: string | null
  orderedAt: string
  resultValue: string | null
  resultUnit: string | null
  referenceRange: string | null
  abnormalFlag: string | null
  resultNote: string | null
  resultedByName: string | null
  resultedAt: string | null
}

/** Row in the patient "Invoices" tab. */
export interface PatientInvoiceRowDTO {
  id: string
  invoiceNumber: string
  category: string | null
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'CANCELLED'
  totalAmount: string
  paidAmount: string
  balanceDue: string
  createdAt: string
  lineCount: number
}
