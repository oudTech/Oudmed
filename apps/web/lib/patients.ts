import { api } from './api'
import type {
  ComplaintDTO,
  DiagnosisDTO,
  DuplicateMatch,
  PatientDTO,
  PatientDocumentDTO,
  PatientInvoiceRowDTO,
  PatientListItemDTO,
  PatientListResponse,
  PatientOrderRowDTO,
  PatientStatsResponse,
  PatientVisitRowDTO,
  PrescriptionDTO,
  VitalSignsDTO,
} from '@oudhealth/contracts'

export const patientsApi = {
  list: (params: { search?: string; filter?: string; gender?: string; page?: number }) =>
    api.get<PatientListResponse>('/patients', { params }).then((r) => r.data),

  stats: () => api.get<PatientStatsResponse>('/patients/stats').then((r) => r.data),

  get: (id: string) => api.get<PatientDTO>(`/patients/${id}`).then((r) => r.data),

  checkDuplicates: (data: { firstName?: string; lastName?: string; phone?: string; dateOfBirth?: string }) =>
    api.post<{ matches: DuplicateMatch[] }>('/patients/check-duplicates', data).then((r) => r.data),

  create: (data: Record<string, unknown>) =>
    api.post<PatientDTO>('/patients', data).then((r) => r.data),

  update: (id: string, data: Record<string, unknown>) =>
    api.patch<PatientDTO>(`/patients/${id}`, data).then((r) => r.data),

  // tabs
  appointments: (id: string) =>
    api.get<PatientVisitRowDTO[]>(`/patients/${id}/appointments`).then((r) => r.data),
  invoices: (id: string) =>
    api.get<PatientInvoiceRowDTO[]>(`/patients/${id}/invoices`).then((r) => r.data),
  orders: (id: string) =>
    api.get<PatientOrderRowDTO[]>(`/patients/${id}/orders`).then((r) => r.data),
  payInvoice: (
    id: string,
    invoiceId: string,
    data: { amount: number; method?: string; idempotencyKey?: string },
  ) => api.post(`/patients/${id}/invoices/${invoiceId}/payments`, data).then((r) => r.data),
  documents: (id: string) =>
    api.get<PatientDocumentDTO[]>(`/patients/${id}/documents`).then((r) => r.data),
  documentUrl: (id: string, docId: string) =>
    api.get<{ url: string }>(`/patients/${id}/documents/${docId}/url`).then((r) => r.data.url),
  addDocument: (id: string, data: { category: string; title: string; note?: string; file: File }) => {
    const fd = new FormData()
    fd.append('file', data.file)
    fd.append('category', data.category)
    fd.append('title', data.title)
    if (data.note) fd.append('note', data.note)
    return api.post(`/patients/${id}/documents`, fd).then((r) => r.data)
  },
  deleteDocument: (id: string, docId: string) =>
    api.delete(`/patients/${id}/documents/${docId}`).then((r) => r.data),
  setPhoto: (id: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<{ photoUrl: string | null }>(`/patients/${id}/photo`, fd).then((r) => r.data)
  },

  complaints: (id: string) => api.get<ComplaintDTO[]>(`/patients/${id}/complaints`).then((r) => r.data),
  addComplaint: (id: string, data: Record<string, unknown>) =>
    api.post(`/patients/${id}/complaints`, data).then((r) => r.data),
  updateComplaint: (id: string, cid: string, data: Record<string, unknown>) =>
    api.patch(`/patients/${id}/complaints/${cid}`, data).then((r) => r.data),

  diagnoses: (id: string) => api.get<DiagnosisDTO[]>(`/patients/${id}/diagnoses`).then((r) => r.data),
  addDiagnosis: (id: string, data: Record<string, unknown>) =>
    api.post(`/patients/${id}/diagnoses`, data).then((r) => r.data),

  vitals: (id: string) => api.get<VitalSignsDTO[]>(`/patients/${id}/vitals`).then((r) => r.data),
  addVitals: (id: string, data: Record<string, unknown>) =>
    api.post(`/patients/${id}/vitals`, data).then((r) => r.data),

  prescriptions: (id: string) =>
    api.get<PrescriptionDTO[]>(`/patients/${id}/prescriptions`).then((r) => r.data),
  addPrescription: (id: string, data: Record<string, unknown>) =>
    api.post(`/patients/${id}/prescriptions`, data).then((r) => r.data),
  updatePrescription: (id: string, rid: string, status: string) =>
    api.patch(`/patients/${id}/prescriptions/${rid}`, { status }).then((r) => r.data),
}

export function patientName(p: {
  firstName: string
  middleName?: string | null
  lastName: string
}): string {
  return [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ')
}

export const PATIENT_STATUS_META: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  ACTIVE: { label: 'Active', color: '#047857', bg: '#EAF7F0' },
  INPATIENT: { label: 'Inpatient', color: '#1E40AF', bg: '#E4EFFF' },
  INCOMPLETE: { label: 'Incomplete', color: '#B45309', bg: '#FFF6E5' },
}

// Registration enum lists live in @oudhealth/validation (single source of truth,
// mirrors the Prisma enums) and are re-exported here for the patient screens.
export {
  MARITAL_STATUS,
  BLOOD_GROUPS,
  RH_FACTORS,
  GENOTYPES,
  PREGNANCY_STATUS,
  ID_DOC_TYPES,
} from '@oudhealth/validation'
export const DOC_CATEGORIES = [
  'IDENTIFICATION',
  'PHOTO',
  'LAB_RESULT',
  'IMAGING',
  'REFERRAL',
  'CONSENT',
  'INSURANCE_CARD',
  'DISCHARGE_SUMMARY',
  'OTHER',
]

export const DIAGNOSIS_CERTAINTY = [
  'PROVISIONAL',
  'WORKING',
  'DIFFERENTIAL',
  'FINAL',
  'RULED_OUT',
]
export const ATTENDANCE_TYPES = [
  'Consultation',
  'Follow-up',
  'Special-care attendance',
  'Emergency',
  'Review',
]
export const DRUG_ROUTES = [
  'PO (Oral)',
  'IV (Intravenous)',
  'IM (Intramuscular)',
  'SC (Subcutaneous)',
  'Topical',
  'Inhalation',
  'PR (Rectal)',
  'Sublingual',
]
export const DOSAGE_FORMS = [
  'Tablet',
  'Capsule',
  'Syrup',
  'Suspension',
  'Injection',
  'Cream',
  'Ointment',
  'Drops',
  'Inhaler',
  'Suppository',
]
export const DRUG_FREQUENCIES = [
  'OD (once a day)',
  'BD (twice a day)',
  'TID (three times a day)',
  'QID (four times a day)',
  'Nocte (at night)',
  'PRN (as needed)',
  'Stat (once now)',
]
export const FOOD_RELATIONS = ['Before food', 'With food', 'After food', 'No relation']
export const DURATION_TYPES = ['Days', 'Weeks', 'Months']
export const AVPU_OPTIONS = ['A', 'V', 'P', 'U']
export const PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER', 'HMO']

export const PRESCRIPTION_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  ACTIVE: { label: 'Active', color: '#047857', bg: '#EAF7F0' },
  COMPLETED: { label: 'Completed', color: '#475467', bg: '#F2F4F7' },
  CANCELLED: { label: 'Cancelled', color: '#B42318', bg: '#FEECEB' },
}

export const INVOICE_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  PAID: { label: 'Paid', color: '#047857', bg: '#EAF7F0' },
  PARTIAL: { label: 'Part paid', color: '#B45309', bg: '#FFF6E5' },
  UNPAID: { label: 'Unpaid', color: '#B42318', bg: '#FEECEB' },
  CANCELLED: { label: 'Cancelled', color: '#6B7280', bg: '#F3F4F6' },
}

/**
 * Flags a vital-sign reading as low / high against a normal adult range so the
 * table can highlight it, matching the red cells in the design.
 */
const VITAL_RANGES: Record<string, [number, number]> = {
  temperatureC: [36.1, 37.5],
  pulseBpm: [60, 100],
  respiratoryRate: [12, 20],
  systolicBp: [90, 139],
  diastolicBp: [60, 89],
  spo2: [95, 100],
  bloodGlucose: [3.9, 7.8],
}

export function vitalFlag(
  metric: keyof typeof VITAL_RANGES,
  value: number | string | null | undefined,
): 'low' | 'high' | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'string' ? Number(value) : value
  if (Number.isNaN(n)) return null
  const range = VITAL_RANGES[metric]
  if (!range) return null
  if (n < range[0]) return 'low'
  if (n > range[1]) return 'high'
  return null
}

export function titleCase(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
