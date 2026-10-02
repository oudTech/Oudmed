export type InpatientChargeRule = 'MIDNIGHT_CENSUS' | 'ROLLING_24H'
export type ShortStayChargeMode = 'NONE' | 'MINIMUM_FULL_DAY' | 'DAY_CASE_RATE'

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
  inpatientChargeRule: InpatientChargeRule
  shortStayChargeMode: ShortStayChargeMode
  requireSettledBillAtDischarge: boolean
  requirePaymentBeforeDispense: boolean
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
  inpatientChargeRule?: InpatientChargeRule
  shortStayChargeMode?: ShortStayChargeMode
  requireSettledBillAtDischarge?: boolean
  requirePaymentBeforeDispense?: boolean
}

export const INPATIENT_CHARGE_RULES: { value: InpatientChargeRule; label: string; hint: string }[] = [
  { value: 'MIDNIGHT_CENSUS', label: 'Midnight census', hint: 'One bed-day for every Lagos midnight the patient is still admitted.' },
  { value: 'ROLLING_24H', label: 'Rolling 24 hours', hint: 'One bed-day per full-or-partial 24-hour block from admission time.' },
]

export const SHORT_STAY_CHARGE_MODES: { value: ShortStayChargeMode; label: string; hint: string }[] = [
  { value: 'NONE', label: 'No charge', hint: 'A stay that never crosses a midnight is free.' },
  { value: 'MINIMUM_FULL_DAY', label: 'Minimum one full day', hint: "Charged one full night at the ward's daily rate." },
  { value: 'DAY_CASE_RATE', label: 'Day-case rate', hint: "Charged once at the ward's own day-case rate." },
]
