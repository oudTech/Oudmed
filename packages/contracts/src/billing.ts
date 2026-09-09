export type InvoiceStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'CANCELLED'
export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'HMO'
export type BillingPayerType = 'CASH' | 'HMO' | 'NHIS' | 'RETAINER'

export const BILLING_ITEM_TYPES = ['Services', 'Laboratory', 'Medication', 'Others'] as const

export const PAYER_TYPES: { value: BillingPayerType; label: string }[] = [
  { value: 'CASH', label: 'Patient' },
  { value: 'HMO', label: 'HMO' },
  { value: 'NHIS', label: 'NHIS' },
  { value: 'RETAINER', label: 'Company' },
]

export const INVOICE_STATUS_META: Record<InvoiceStatus, { label: string; color: string; bg: string }> = {
  PAID: { label: 'Paid', color: '#047857', bg: '#EAF7F0' },
  PARTIAL: { label: 'Partially paid', color: '#B45309', bg: '#FFF6E5' },
  UNPAID: { label: 'Unpaid', color: '#B42318', bg: '#FEECEB' },
  CANCELLED: { label: 'Cancelled', color: '#6B7280', bg: '#F3F4F6' },
}

export interface InvoiceLineDTO {
  id: string
  category: string | null
  description: string
  quantity: number
  unitPrice: string
  grossAmount: string
  discountPct: string | null
  lineTotal: string
  drugId: string | null
  providedByName: string | null
  providedAt: string | null
}

export interface PaymentDTO {
  id: string
  receiptNumber: string | null
  amount: string
  method: PaymentMethod
  payerType: BillingPayerType
  payerName: string | null
  reference: string | null
  note: string | null
  receivedByName: string | null
  paidAt: string
  reversedAt: string | null
  reversalReason: string | null
}

export interface InvoiceListItemDTO {
  id: string
  invoiceNumber: string
  createdAt: string
  patient: { id: string; name: string; patientNumber: string } | null
  category: string | null
  payerType: BillingPayerType
  subtotal: string
  totalAmount: string
  paidAmount: string
  balanceDue: string
  status: InvoiceStatus
  lineCount: number
}

export interface InvoiceListSummaryDTO {
  amount: string
  paid: string
  balance: string
  count: number
}

export interface InvoiceListResponse {
  page: number
  pageSize: number
  total: number
  invoices: InvoiceListItemDTO[]
  summary: InvoiceListSummaryDTO
}

export interface InvoiceDetailDTO {
  id: string
  invoiceNumber: string
  createdAt: string
  status: InvoiceStatus
  category: string | null
  payerType: BillingPayerType
  subtotal: string
  discountPct: string | null
  discountReason: string | null
  totalAmount: string
  paidAmount: string
  balanceDue: string
  note: string | null
  createdByName: string | null
  cancelledAt: string | null
  voidReason: string | null
  patient: { id: string; name: string; patientNumber: string; phone: string | null } | null
  visitId: string | null
  claim: { id: string; claimNumber: string; status: string } | null
  lines: InvoiceLineDTO[]
  payments: PaymentDTO[]
}

export interface BillingCatalogueItemDTO {
  id: string
  name: string
  unitPrice: string
  category: string | null
  stock: number | null
  packaging: string | null
}

export interface ReceiptDTO {
  hospitalName: string
  hospitalLogo: string | null
  hospitalAddress: string | null
  hospitalPhone: string | null
  hospitalRcNumber: string | null
  hospitalTaxId: string | null
  documentFooter: string | null
  receiptNumber: string
  paidAt: string
  amount: string
  method: PaymentMethod
  payerType: BillingPayerType
  payerName: string | null
  reference: string | null
  cashierName: string | null
  invoiceNumber: string
  invoiceTotal: string
  balanceAfter: string
  patient: { name: string; patientNumber: string } | null
  lines: { description: string; quantity: number; lineTotal: string }[]
}

/** Kept for back-compat with existing imports. */
export interface InvoiceDTO {
  id: string
  invoiceNumber: string
  status: InvoiceStatus
  totalAmount: string
  patientId: string
  createdAt: string
  lines: InvoiceLineDTO[]
  payments: PaymentDTO[]
}
