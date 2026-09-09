export interface HospitalSettingsDTO {
  id: string
  name: string
  slug: string
  facilityType: string
  address: string | null
  phone: string | null
  contactEmail: string | null
  website: string | null
  rcNumber: string | null
  taxId: string | null
  /** Presigned URL a browser can load, or null. */
  logoUrl: string | null
  primaryColor: string
  invoicePrefix: string
  receiptPrefix: string
  documentFooter: string | null
}

export interface UpdateHospitalSettingsDTO {
  name?: string
  address?: string | null
  phone?: string | null
  contactEmail?: string | null
  website?: string | null
  rcNumber?: string | null
  taxId?: string | null
  primaryColor?: string
  invoicePrefix?: string
  receiptPrefix?: string
  documentFooter?: string | null
}
