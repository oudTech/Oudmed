import { api } from './api'
import type { EncounterDTO, PharmacyQueueItemDTO, ServiceItemDTO } from '@oudhealth/contracts'

export const encountersApi = {
  get: (visitId: string) =>
    api.get<EncounterDTO>(`/encounters/${visitId}`).then((r) => r.data),

  saveNote: (
    visitId: string,
    data: { subjective?: string; objective?: string; assessment?: string; plan?: string },
  ) => api.put(`/encounters/${visitId}/note`, data).then((r) => r.data),

  createOrder: (
    visitId: string,
    data: {
      orderType: string
      serviceItemId?: string
      name?: string
      unitPrice?: number
      quantity?: number
      priority?: string
      clinicalNote?: string
    },
  ) => api.post(`/encounters/${visitId}/orders`, data).then((r) => r.data),

  updateOrder: (
    orderId: string,
    data: {
      status?: string
      resultValue?: string
      resultUnit?: string
      referenceRange?: string
      abnormalFlag?: string
      resultNote?: string
    },
  ) => api.patch(`/encounters/orders/${orderId}`, data).then((r) => r.data),

  serviceItems: (category?: string, q?: string) =>
    api
      .get<ServiceItemDTO[]>('/billing/service-items', { params: { category, q } })
      .then((r) => r.data),

  labWorklist: (status?: string) =>
    api.get<any[]>('/lab/worklist', { params: { status } }).then((r) => r.data),
}

export const pharmacyApi = {
  queue: (status?: string) =>
    api.get<PharmacyQueueItemDTO[]>('/pharmacy/queue', { params: { status } }).then((r) => r.data),
  dispense: (
    id: string,
    data: { items: { itemId: string; quantity: number; unitPrice: number }[]; note?: string },
  ) => api.post(`/pharmacy/prescriptions/${id}/dispense`, data).then((r) => r.data),
  cancel: (id: string) =>
    api.patch(`/pharmacy/prescriptions/${id}/cancel`).then((r) => r.data),
}

export const ORDER_TYPE_LABEL: Record<string, string> = {
  LABORATORY: 'Laboratory',
  IMAGING: 'Imaging',
  PROCEDURE: 'Procedure',
}

export const ORDER_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  ORDERED: { label: 'Ordered', color: '#B45309', bg: '#FFF6E5' },
  IN_PROGRESS: { label: 'In progress', color: '#4338CA', bg: '#EEF0FF' },
  RESULTED: { label: 'Resulted', color: '#047857', bg: '#EAF7F0' },
  CANCELLED: { label: 'Cancelled', color: '#6B7280', bg: '#F3F4F6' },
}

export const DISPENSE_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: 'Awaiting dispense', color: '#B45309', bg: '#FFF6E5' },
  PARTIAL: { label: 'Part dispensed', color: '#4338CA', bg: '#EEF0FF' },
  DISPENSED: { label: 'Dispensed', color: '#047857', bg: '#EAF7F0' },
  CANCELLED: { label: 'Cancelled', color: '#6B7280', bg: '#F3F4F6' },
}

export const ABNORMAL_FLAGS = ['Normal', 'Low', 'High', 'Critical']
export const ORDER_PRIORITIES = ['Routine', 'Urgent', 'STAT']
