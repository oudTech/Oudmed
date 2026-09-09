export type InsuranceKind = 'HMO' | 'INSURANCE' | 'COMPANY' | 'NHIS'

export const INSURANCE_KINDS: { value: InsuranceKind; label: string }[] = [
  { value: 'HMO', label: 'HMO' },
  { value: 'INSURANCE', label: 'Insurance' },
  { value: 'COMPANY', label: 'Company' },
  { value: 'NHIS', label: 'NHIS' },
]

export const SERVICE_CATEGORIES = [
  'Consultation',
  'Laboratory',
  'Imaging',
  'Procedure',
  'Services',
  'Admission',
  'Others',
] as const

export interface AdminListResponse<T> {
  page: number
  pageSize: number
  total: number
  rows: T[]
}

export interface DepartmentAdminDTO {
  id: string
  name: string
  code: string | null
  phone: string | null
  notes: string | null
  isActive: boolean
  userCount: number
}

export interface ServiceItemAdminDTO {
  id: string
  code: string | null
  name: string
  category: string | null
  unitPrice: string
  isActive: boolean
}

export interface InsuranceProviderDTO {
  id: string
  name: string
  kind: InsuranceKind
  phone: string | null
  email: string | null
  address: string | null
  contactPerson: string | null
  notes: string | null
  isActive: boolean
  patientCount: number
}

export interface InsuranceProviderOptionDTO {
  id: string
  name: string
  kind: InsuranceKind
}
