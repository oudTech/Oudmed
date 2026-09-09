import { api } from './api'
import type {
  BillingCatalogueItemDTO,
  InvoiceDetailDTO,
  InvoiceListResponse,
  ReceiptDTO,
} from '@oudhealth/contracts'

export { INVOICE_STATUS_META, PAYER_TYPES, BILLING_ITEM_TYPES } from '@oudhealth/contracts'

export const naira = (v: string | number) =>
  '₦' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })

export const billingApi = {
  listInvoices: (params: {
    search?: string
    status?: string
    category?: string
    from?: string
    to?: string
    page?: number
  }) => api.get<InvoiceListResponse>('/billing/invoices', { params }).then((r) => r.data),

  getInvoice: (id: string) =>
    api.get<InvoiceDetailDTO>(`/billing/invoices/${id}`).then((r) => r.data),

  createInvoice: (data: Record<string, unknown>) =>
    api.post<{ id: string }>('/billing/invoices', data).then((r) => r.data),

  recordPayment: (
    invoiceId: string,
    data: {
      amount: number
      method: string
      payerType?: string
      payerName?: string
      reference?: string
      note?: string
      idempotencyKey?: string
    },
  ) =>
    api
      .post<{ paymentId: string; receiptNumber: string | null; status: string; balanceDue: string }>(
        `/billing/invoices/${invoiceId}/payments`,
        data,
      )
      .then((r) => r.data),

  cancelInvoice: (id: string, reason: string) =>
    api.post(`/billing/invoices/${id}/cancel`, { reason }).then((r) => r.data),

  reversePayment: (paymentId: string, reason: string) =>
    api.post(`/billing/payments/${paymentId}/reverse`, { reason }).then((r) => r.data),

  receipt: (paymentId: string) =>
    api.get<ReceiptDTO>(`/billing/payments/${paymentId}/receipt`).then((r) => r.data),

  catalogue: (type: string, q?: string) =>
    api
      .get<BillingCatalogueItemDTO[]>('/billing/catalogue', { params: { type, q } })
      .then((r) => r.data),
}

/** A per-attempt payment idempotency key (SSR-safe: falls back if Web Crypto is absent). */
export const newIdempotencyKey = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`

export const CATEGORY_CHIPS = ['Consultation', 'Laboratory', 'Imaging', 'Medication', 'Procedure', 'Services']
export const STATUS_CHIPS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'PARTIAL', label: 'Partially paid' },
  { value: 'PAID', label: 'Paid' },
  { value: 'CANCELLED', label: 'Cancelled' },
]
