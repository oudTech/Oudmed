import { api } from './api'
import type {
  ClaimBatchDetailDTO,
  ClaimBatchListResponse,
  ClaimDetailDTO,
  ClaimListResponse,
  ClaimRemittanceDetailDTO,
  ClaimRemittanceListResponse,
  ClaimsReceivablesDTO,
  EligibleVisitDTO,
  GenerateClaimsResultDTO,
  OpenClaimDTO,
} from '@oudhealth/contracts'

export {
  CLAIM_STATUS_META,
  CLAIM_BATCH_STATUS_META,
  CLAIM_STATUS_CHIPS,
  SHORTFALL_ACTIONS,
} from '@oudhealth/contracts'
export { naira } from './billing'

type RangeParams = { from?: string; to?: string }

export const claimsApi = {
  list: (params: RangeParams & { status?: string; providerId?: string; batchId?: string; search?: string; page?: number }) =>
    api.get<ClaimListResponse>('/claims', { params }).then((r) => r.data),
  get: (id: string) => api.get<ClaimDetailDTO>(`/claims/${id}`).then((r) => r.data),
  eligibleVisits: (params: RangeParams & { providerId?: string }) =>
    api.get<EligibleVisitDTO[]>('/claims/eligible-visits', { params }).then((r) => r.data),
  generate: (visitIds: string[]) =>
    api.post<GenerateClaimsResultDTO>('/claims/generate', { visitIds }).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch<ClaimDetailDTO>(`/claims/${id}`, data).then((r) => r.data),
  submit: (id: string, batchId?: string) =>
    api.post<ClaimDetailDTO>(`/claims/${id}/submit`, { batchId }).then((r) => r.data),
  writeOff: (id: string, reason: string) =>
    api.post<ClaimDetailDTO>(`/claims/${id}/write-off`, { reason }).then((r) => r.data),
  cancel: (id: string, reason: string) =>
    api.post(`/claims/${id}/cancel`, { reason }).then((r) => r.data),

  batches: {
    list: (params: { providerId?: string; status?: string; page?: number }) =>
      api.get<ClaimBatchListResponse>('/claims/batches', { params }).then((r) => r.data),
    get: (id: string) => api.get<ClaimBatchDetailDTO>(`/claims/batches/${id}`).then((r) => r.data),
    create: (data: { providerId: string; periodStart: string; periodEnd: string; claimIds?: string[]; notes?: string }) =>
      api.post<ClaimBatchDetailDTO>('/claims/batches', data).then((r) => r.data),
    add: (id: string, claimIds: string[]) =>
      api.post<ClaimBatchDetailDTO>(`/claims/batches/${id}/add`, { claimIds }).then((r) => r.data),
    remove: (id: string, claimIds: string[]) =>
      api.post<ClaimBatchDetailDTO>(`/claims/batches/${id}/remove`, { claimIds }).then((r) => r.data),
    submit: (id: string, submissionRef?: string) =>
      api.post<ClaimBatchDetailDTO>(`/claims/batches/${id}/submit`, { submissionRef }).then((r) => r.data),
    close: (id: string) => api.post<ClaimBatchDetailDTO>(`/claims/batches/${id}/close`).then((r) => r.data),
    downloadCsv: async (id: string) => {
      const res = await api.get(`/claims/batches/${id}/export.csv`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'claim-schedule.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    },
  },

  remittances: {
    list: (params: { providerId?: string; page?: number }) =>
      api.get<ClaimRemittanceListResponse>('/claims/remittances', { params }).then((r) => r.data),
    get: (id: string) => api.get<ClaimRemittanceDetailDTO>(`/claims/remittances/${id}`).then((r) => r.data),
    openClaims: (providerId: string, batchId?: string) =>
      api.get<OpenClaimDTO[]>('/claims/remittances/open-claims', { params: { providerId, batchId } }).then((r) => r.data),
    create: (data: Record<string, unknown>) =>
      api.post<{ id: string; remittanceNumber: string; receivedAmount: string; allocatedAmount: string; variance: string }>(
        '/claims/remittances',
        data,
      ).then((r) => r.data),
    reverse: (id: string, reason: string) =>
      api.post(`/claims/remittances/${id}/reverse`, { reason }).then((r) => r.data),
  },

  receivables: () => api.get<ClaimsReceivablesDTO>('/claims/receivables').then((r) => r.data),
}
