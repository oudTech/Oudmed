import { api } from './api'
import type {
  CardCheckoutResultDTO,
  PlatformPricingDTO,
  SubscriptionInvoiceDTO,
  SubscriptionSummaryDTO,
} from '@oudhealth/contracts'

export const subscriptionsApi = {
  getPricing: () => api.get<PlatformPricingDTO>('/subscriptions/pricing').then((r) => r.data),
  getMine: () => api.get<SubscriptionSummaryDTO>('/subscriptions/me').then((r) => r.data),
  listInvoices: () => api.get<SubscriptionInvoiceDTO[]>('/subscriptions/invoices').then((r) => r.data),
  checkoutCard: (billingCycle: 'MONTHLY' | 'ANNUAL') =>
    api.post<CardCheckoutResultDTO>('/subscriptions/checkout/card', { billingCycle }).then((r) => r.data),
  checkoutBankTransfer: (billingCycle: 'MONTHLY' | 'ANNUAL') =>
    api.post<SubscriptionInvoiceDTO>('/subscriptions/checkout/bank-transfer', { billingCycle }).then((r) => r.data),
  verifyCheckout: (reference: string) =>
    api.get<SubscriptionInvoiceDTO>('/subscriptions/checkout/verify', { params: { reference } }).then((r) => r.data),
  // Confirming a bank-transfer invoice is a platform-operator action, not
  // something a hospital does to itself - see lib/platform.ts's
  // `platformApiClient.subscriptions.markInvoicePaid` (different URL, different
  // guard, a platform bearer token, not this hospital-scoped `api` instance).
}
