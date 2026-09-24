export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED'
export type BillingCycle = 'MONTHLY' | 'ANNUAL'
export type SubscriptionInvoiceStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED'
export type SubscriptionPaymentMethod = 'CARD' | 'BANK_TRANSFER'

/** Platform-wide pricing, editable by SUPER_ADMIN. Public - no auth required to read. */
export interface PlatformPricingDTO {
  currency: string
  adminSeatPriceMonthly: string
  otherSeatPriceMonthly: string
  annualDiscountPct: string
  vatPct: string
  /** OudHealth's own TIN, printed on subscription invoices once set. */
  platformTin: string | null
  trialDays: number
}

export interface UpdatePlatformPricingDTO {
  adminSeatPriceMonthly?: number
  otherSeatPriceMonthly?: number
  annualDiscountPct?: number
  vatPct?: number
  platformTin?: string | null
  trialDays?: number
  currency?: string
}

/** A tenant's current seat breakdown and what it costs, net and VAT-inclusive, at each cycle. */
export interface SeatBreakdownDTO {
  adminSeats: number
  otherSeats: number
  monthlyNet: string
  monthlyVat: string
  monthlyGross: string
  annualNet: string
  annualVat: string
  annualGross: string
}

export type SubscriptionAccessLevel = 'FULL' | 'READ_ONLY'

export interface SubscriptionSummaryDTO {
  status: SubscriptionStatus
  billingCycle: BillingCycle
  trialEndsAt: string | null
  trialDaysRemaining: number | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  pricing: PlatformPricingDTO
  seats: SeatBreakdownDTO
  /** What the hospital can currently do - see EntitlementsService for the grace-period rules. */
  accessLevel: SubscriptionAccessLevel
  /** True once a card has ever succeeded - renewals will attempt to auto-charge it. */
  hasSavedCard: boolean
}

export interface SubscriptionInvoiceDTO {
  id: string
  invoiceNumber: string
  billingCycle: BillingCycle
  netAmount: string
  vatAmount: string
  totalAmount: string
  currency: string
  status: SubscriptionInvoiceStatus
  paymentMethod: SubscriptionPaymentMethod
  paidAt: string | null
  createdAt: string
}

export interface CardCheckoutResultDTO {
  invoiceId: string
  authorizationUrl: string
  reference: string
}
