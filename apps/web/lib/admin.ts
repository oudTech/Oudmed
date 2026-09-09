import { api } from './api'
import type {
  AdminListResponse,
  DepartmentAdminDTO,
  InsuranceProviderDTO,
  InsuranceProviderOptionDTO,
  ServiceItemAdminDTO,
} from '@oudhealth/contracts'

export { INSURANCE_KINDS, SERVICE_CATEGORIES } from '@oudhealth/contracts'
export { naira } from './billing'

type ListParams = { search?: string; category?: string; kind?: string; status?: string; page?: number }

export const adminApi = {
  departments: {
    list: (params: ListParams) =>
      api.get<AdminListResponse<DepartmentAdminDTO>>('/admin/departments', { params }).then((r) => r.data),
    create: (data: Record<string, unknown>) =>
      api.post<DepartmentAdminDTO>('/admin/departments', data).then((r) => r.data),
    update: (id: string, data: Record<string, unknown>) =>
      api.patch<DepartmentAdminDTO>(`/admin/departments/${id}`, data).then((r) => r.data),
    toggle: (id: string) =>
      api.post<DepartmentAdminDTO>(`/admin/departments/${id}/toggle`).then((r) => r.data),
    remove: (id: string) => api.delete(`/admin/departments/${id}`).then((r) => r.data),
  },
  services: {
    list: (params: ListParams) =>
      api.get<AdminListResponse<ServiceItemAdminDTO>>('/admin/services', { params }).then((r) => r.data),
    create: (data: Record<string, unknown>) =>
      api.post<ServiceItemAdminDTO>('/admin/services', data).then((r) => r.data),
    update: (id: string, data: Record<string, unknown>) =>
      api.patch<ServiceItemAdminDTO>(`/admin/services/${id}`, data).then((r) => r.data),
    toggle: (id: string) =>
      api.post<ServiceItemAdminDTO>(`/admin/services/${id}/toggle`).then((r) => r.data),
    remove: (id: string) => api.delete(`/admin/services/${id}`).then((r) => r.data),
  },
  providers: {
    list: (params: ListParams) =>
      api.get<AdminListResponse<InsuranceProviderDTO>>('/admin/insurance-providers', { params }).then((r) => r.data),
    create: (data: Record<string, unknown>) =>
      api.post<InsuranceProviderDTO>('/admin/insurance-providers', data).then((r) => r.data),
    update: (id: string, data: Record<string, unknown>) =>
      api.patch<InsuranceProviderDTO>(`/admin/insurance-providers/${id}`, data).then((r) => r.data),
    toggle: (id: string) =>
      api.post<InsuranceProviderDTO>(`/admin/insurance-providers/${id}/toggle`).then((r) => r.data),
    remove: (id: string) => api.delete(`/admin/insurance-providers/${id}`).then((r) => r.data),
    options: (kind?: string) =>
      api
        .get<InsuranceProviderOptionDTO[]>('/admin/insurance-providers/options', {
          params: kind ? { kind } : undefined,
        })
        .then((r) => r.data),
  },
}

export const KIND_BADGE: Record<string, { color: string; bg: string }> = {
  HMO: { color: '#1E40AF', bg: '#E4EFFF' },
  INSURANCE: { color: '#4338CA', bg: '#EEF0FF' },
  COMPANY: { color: '#B45309', bg: '#FFF6E5' },
  NHIS: { color: '#047857', bg: '#EAF7F0' },
}

export const KIND_LABEL: Record<string, string> = {
  HMO: 'HMO',
  INSURANCE: 'Insurance',
  COMPANY: 'Company',
  NHIS: 'NHIS',
}
