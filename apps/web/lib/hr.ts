import { api } from './api'
import type { StaffDetailDTO, StaffListResponse } from '@oudhealth/contracts'

export { HR_ROLES, ROLE_LABEL } from '@oudhealth/contracts'

export const staffApi = {
  list: (params: { search?: string; role?: string; status?: string; page?: number }) =>
    api.get<StaffListResponse>('/staff', { params }).then((r) => r.data),
  get: (id: string) => api.get<StaffDetailDTO>(`/staff/${id}`).then((r) => r.data),
  create: (data: Record<string, unknown>) =>
    api.post<StaffDetailDTO>('/staff', data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch<StaffDetailDTO>(`/staff/${id}`, data).then((r) => r.data),
  activate: (id: string) => api.post<StaffDetailDTO>(`/staff/${id}/activate`).then((r) => r.data),
  deactivate: (id: string) => api.post<StaffDetailDTO>(`/staff/${id}/deactivate`).then((r) => r.data),
  setPassword: (id: string, password: string) =>
    api.post(`/staff/${id}/set-password`, { password }).then((r) => r.data),
}

export const ROLE_BADGE: Record<string, { color: string; bg: string }> = {
  SUPER_ADMIN: { color: '#5B21B6', bg: '#EDE9FE' },
  HOSPITAL_ADMIN: { color: '#1E40AF', bg: '#E4EFFF' },
  DOCTOR: { color: '#047857', bg: '#EAF7F0' },
  NURSE: { color: '#0E7490', bg: '#E0F2FE' },
  RECEPTIONIST: { color: '#B45309', bg: '#FFF6E5' },
  PHARMACIST: { color: '#9D174D', bg: '#FCE7F3' },
  LAB_STAFF: { color: '#4338CA', bg: '#EEF0FF' },
  ACCOUNTANT: { color: '#475467', bg: '#F2F4F7' },
}
