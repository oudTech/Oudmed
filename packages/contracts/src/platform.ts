import type { BillingCycle, SubscriptionInvoiceStatus, SubscriptionPaymentMethod, SubscriptionStatus } from './subscription'

/** One row on the Super Admin "All Hospitals" list. */
export interface PlatformTenantSummaryDTO {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  contactEmail: string | null
  address: string | null
  isActive: boolean
  subscriptionStatus: SubscriptionStatus
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  users: number
  patients: number
  monthlyRevenue: string
  lastActivityAt: string | null
  joinedAt: string
}

export interface PlatformTenantInvoiceDTO {
  id: string
  invoiceNumber: string
  billingCycle: BillingCycle
  totalAmount: string
  currency: string
  status: SubscriptionInvoiceStatus
  paymentMethod: SubscriptionPaymentMethod
  paidAt: string | null
  createdAt: string
}

export interface PlatformTenantDetailDTO extends PlatformTenantSummaryDTO {
  invoices: PlatformTenantInvoiceDTO[]
}

export interface CreateTenantDirectDTO {
  name: string
  address?: string
  adminFullName: string
  adminEmail: string
  adminPassword: string
}

export interface PlatformOverviewDTO {
  totalHospitals: number
  newThisMonth: number
  statusCounts: Record<SubscriptionStatus, number>
  estimatedMonthlyRevenue: string
  revenueTrend: { month: string; total: string }[]
}

export interface PlatformActivityItemDTO {
  id: string
  action: string
  entityType: string
  createdAt: string
  message: string
}

export interface PlatformSubscriptionRowDTO {
  tenantId: string
  hospitalName: string
  slug: string
  status: SubscriptionStatus
  billingCycle: BillingCycle
  monthlyGross: string
  annualGross: string
  currentPeriodEnd: string | null
  trialEndsAt: string | null
}

export interface SubscriptionInvoiceStatsDTO {
  successful: number
  failed: number
  pending: number
  refunded: number
}

export interface PlatformConfigDTO {
  platformName: string
  supportEmail: string | null
  supportPhone: string | null
  supportHours: string | null
  logoUrl: string | null
  defaultCountry: string
  defaultCurrency: string
  timeFormat: string
  maintenanceMode: boolean
}

export interface UpdatePlatformConfigDTO {
  platformName?: string
  supportEmail?: string
  supportPhone?: string
  supportHours?: string
  defaultCountry?: string
  defaultCurrency?: string
  timeFormat?: string
}

export interface PlatformUserDTO {
  id: string
  email: string
  fullName: string
  isActive: boolean
  createdAt: string
  lastLoginAt: string | null
}

export interface CreatePlatformUserDTO {
  fullName: string
  email: string
  password: string
}

export interface PlatformProfileDTO {
  id: string
  email: string
  fullName: string
}

export interface UpdatePlatformProfileDTO {
  fullName: string
}

export interface ChangePlatformPasswordDTO {
  currentPassword: string
  newPassword: string
}
