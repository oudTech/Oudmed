import { platformApi } from './platform-api'
import type {
  AdminListResponse,
  ChangePlatformPasswordDTO,
  CreatePlatformUserDTO,
  CreateTenantDirectDTO,
  PlatformActivityItemDTO,
  PlatformConfigDTO,
  PlatformOverviewDTO,
  PlatformPricingDTO,
  PlatformProfileDTO,
  PlatformSubscriptionRowDTO,
  PlatformTenantDetailDTO,
  PlatformTenantSummaryDTO,
  PlatformUserDTO,
  SubscriptionInvoiceStatsDTO,
  UpdatePlatformConfigDTO,
  UpdatePlatformPricingDTO,
  UpdatePlatformProfileDTO,
} from '@oudhealth/contracts'

export { naira } from './billing'

type ListTenantsParams = { search?: string; status?: string; page?: number }
type ListSubscriptionsParams = { status?: string; page?: number }

/** Same blob-download pattern as lib/reports.ts's downloadPaymentsCsv. */
async function downloadCsv(path: string, params: Record<string, unknown>, filename: string) {
  const res = await platformApi.get(path, { params, responseType: 'blob' })
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export const platformApiClient = {
  auth: {
    me: () => platformApi.get<PlatformProfileDTO>('/platform/auth/me').then((r) => r.data),
    updateProfile: (data: UpdatePlatformProfileDTO) =>
      platformApi.patch<PlatformProfileDTO>('/platform/auth/me', data).then((r) => r.data),
    changePassword: (data: ChangePlatformPasswordDTO) =>
      platformApi.patch<{ ok: true }>('/platform/auth/me/password', data).then((r) => r.data),
  },
  tenants: {
    list: (params: ListTenantsParams) =>
      platformApi.get<AdminListResponse<PlatformTenantSummaryDTO>>('/platform/tenants', { params }).then((r) => r.data),
    get: (id: string) => platformApi.get<PlatformTenantDetailDTO>(`/platform/tenants/${id}`).then((r) => r.data),
    create: (data: CreateTenantDirectDTO) =>
      platformApi.post<PlatformTenantDetailDTO>('/platform/tenants', data).then((r) => r.data),
    suspend: (id: string) =>
      platformApi.post<PlatformTenantDetailDTO>(`/platform/tenants/${id}/suspend`).then((r) => r.data),
    reactivate: (id: string) =>
      platformApi.post<PlatformTenantDetailDTO>(`/platform/tenants/${id}/reactivate`).then((r) => r.data),
    exportCsv: (params: ListTenantsParams) => downloadCsv('/platform/tenants/export.csv', params, 'hospitals.csv'),
  },
  overview: () => platformApi.get<PlatformOverviewDTO>('/platform/overview').then((r) => r.data),
  activity: (page?: number) =>
    platformApi
      .get<AdminListResponse<PlatformActivityItemDTO>>('/platform/activity', { params: { page } })
      .then((r) => r.data),
  subscriptions: {
    list: (params: ListSubscriptionsParams) =>
      platformApi
        .get<AdminListResponse<PlatformSubscriptionRowDTO>>('/platform/subscriptions', { params })
        .then((r) => r.data),
    stats: () => platformApi.get<SubscriptionInvoiceStatsDTO>('/platform/subscriptions/stats').then((r) => r.data),
    markInvoicePaid: (tenantId: string, invoiceId: string) =>
      platformApi.patch(`/platform/subscriptions/${tenantId}/invoices/${invoiceId}/mark-paid`).then((r) => r.data),
    exportCsv: (params: ListSubscriptionsParams) =>
      downloadCsv('/platform/subscriptions/export.csv', params, 'subscriptions.csv'),
  },
  pricing: {
    get: () => platformApi.get<PlatformPricingDTO>('/subscriptions/pricing').then((r) => r.data),
    update: (data: UpdatePlatformPricingDTO) =>
      platformApi.patch<PlatformPricingDTO>('/subscriptions/pricing', data).then((r) => r.data),
  },
  config: {
    get: () => platformApi.get<PlatformConfigDTO>('/platform/config').then((r) => r.data),
    update: (data: UpdatePlatformConfigDTO) =>
      platformApi.patch<PlatformConfigDTO>('/platform/config', data).then((r) => r.data),
    setMaintenanceMode: (maintenanceMode: boolean) =>
      platformApi.patch<PlatformConfigDTO>('/platform/config/maintenance', { maintenanceMode }).then((r) => r.data),
  },
  users: {
    list: () => platformApi.get<PlatformUserDTO[]>('/platform/users').then((r) => r.data),
    create: (data: CreatePlatformUserDTO) =>
      platformApi.post<PlatformUserDTO>('/platform/users', data).then((r) => r.data),
    deactivate: (id: string) =>
      platformApi.patch<PlatformUserDTO>(`/platform/users/${id}/deactivate`).then((r) => r.data),
    reactivate: (id: string) =>
      platformApi.patch<PlatformUserDTO>(`/platform/users/${id}/reactivate`).then((r) => r.data),
  },
}

export const STATUS_BADGE: Record<string, { color: string; bg: string }> = {
  ACTIVE: { color: '#047857', bg: '#EAF7F0' },
  TRIALING: { color: '#1D4ED8', bg: '#E8F0FE' },
  PAST_DUE: { color: '#B45309', bg: '#FFF6E5' },
  SUSPENDED: { color: '#B91C1C', bg: '#FEECEC' },
  CANCELLED: { color: '#6B7280', bg: '#F3F4F6' },
}

export const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  TRIALING: 'Trialing',
  PAST_DUE: 'Past due',
  SUSPENDED: 'Suspended',
  CANCELLED: 'Cancelled',
}

export const STATUS_DOT: Record<string, string> = {
  ACTIVE: '#2563EB',
  TRIALING: '#60A5FA',
  PAST_DUE: '#F59E0B',
  SUSPENDED: '#EF4444',
  CANCELLED: '#9CA3AF',
}
