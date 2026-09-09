export type ClaimStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PART_PAID'
  | 'PAID'
  | 'REJECTED'
  | 'WRITTEN_OFF'
  | 'CANCELLED'

export type ClaimBatchStatus = 'OPEN' | 'SUBMITTED' | 'RECONCILED' | 'CLOSED'

export type ShortfallAction = 'WRITE_OFF' | 'BILL_PATIENT' | 'APPEAL'

export const CLAIM_STATUS_META: Record<ClaimStatus, { label: string; color: string; bg: string }> = {
  DRAFT: { label: 'Draft', color: '#6B7280', bg: '#F3F4F6' },
  SUBMITTED: { label: 'Submitted', color: '#1E40AF', bg: '#E4EFFF' },
  PART_PAID: { label: 'Part paid', color: '#B45309', bg: '#FFF6E5' },
  PAID: { label: 'Paid', color: '#047857', bg: '#EAF7F0' },
  REJECTED: { label: 'Rejected', color: '#B42318', bg: '#FEECEB' },
  WRITTEN_OFF: { label: 'Written off', color: '#6B7280', bg: '#F3F4F6' },
  CANCELLED: { label: 'Cancelled', color: '#6B7280', bg: '#F3F4F6' },
}

export const CLAIM_BATCH_STATUS_META: Record<ClaimBatchStatus, { label: string; color: string; bg: string }> = {
  OPEN: { label: 'Open', color: '#6B7280', bg: '#F3F4F6' },
  SUBMITTED: { label: 'Submitted', color: '#1E40AF', bg: '#E4EFFF' },
  RECONCILED: { label: 'Reconciled', color: '#B45309', bg: '#FFF6E5' },
  CLOSED: { label: 'Closed', color: '#047857', bg: '#EAF7F0' },
}

export const SHORTFALL_ACTIONS: { value: ShortfallAction; label: string }[] = [
  { value: 'WRITE_OFF', label: 'Write off the shortfall' },
  { value: 'BILL_PATIENT', label: 'Bill the shortfall to the patient' },
  { value: 'APPEAL', label: 'Appeal the shortfall' },
]

export const CLAIM_STATUS_CHIPS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'PART_PAID', label: 'Part paid' },
  { value: 'PAID', label: 'Paid' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'WRITTEN_OFF', label: 'Written off' },
]

export interface ClaimAgingDTO {
  b0_30: string
  b31_60: string
  b61_90: string
  b90p: string
}

export interface ClaimsSummaryDTO {
  outstanding: string
  aging: ClaimAgingDTO
  approvedUnpaid: string
  rejectedCount: number
  claimCount: number
}

export interface ClaimListItemDTO {
  id: string
  claimNumber: string
  providerName: string
  patientName: string
  patientNumber: string | null
  memberNumber: string
  serviceDate: string
  claimedAmount: string
  approvedAmount: string | null
  paidAmount: string
  outstanding: string
  status: ClaimStatus
  batchNumber: string | null
  submittedAt: string | null
}

export interface ClaimListResponse {
  page: number
  pageSize: number
  total: number
  rows: ClaimListItemDTO[]
  summary: ClaimsSummaryDTO
}

export interface ClaimLineDTO {
  id: string
  invoiceLineId: string | null
  serviceCode: string | null
  description: string
  diagnosisCode: string | null
  quantity: number
  unitPrice: string
  claimedAmount: string
  approvedAmount: string | null
  rejectionCode: string | null
  covered: boolean
}

export interface ClaimAllocationHistoryDTO {
  id: string
  remittanceNumber: string
  receivedAt: string
  approvedAmount: string
  paidAmount: string
  shortfall: string
  shortfallAction: ShortfallAction | null
  reversed: boolean
}

export interface ClaimDetailDTO {
  id: string
  claimNumber: string
  status: ClaimStatus
  providerId: string
  providerName: string
  patient: { id: string; name: string; patientNumber: string } | null
  visitId: string | null
  invoiceId: string | null
  invoiceNumber: string | null
  batchId: string | null
  batchNumber: string | null
  memberName: string
  memberNumber: string
  authCode: string | null
  serviceDate: string
  diagnosisCode: string | null
  diagnosisSummary: string | null
  claimedAmount: string
  approvedAmount: string | null
  paidAmount: string
  patientResponsibility: string
  writeOffAmount: string
  outstanding: string
  rejectionReason: string | null
  notes: string | null
  submittedAt: string | null
  createdByName: string | null
  createdAt: string
  lines: ClaimLineDTO[]
  history: ClaimAllocationHistoryDTO[]
}

export interface ClaimLineInput {
  invoiceLineId?: string | null
  serviceCode?: string | null
  description: string
  diagnosisCode?: string | null
  quantity: number
  unitPrice: number
  claimedAmount: number
  covered?: boolean
}

export interface EligibleVisitDTO {
  visitId: string
  invoiceId: string
  patientName: string
  patientNumber: string
  providerId: string | null
  providerName: string | null
  serviceDate: string
  invoiceTotal: string
}

export interface GenerateClaimsResultDTO {
  created: string[]
  skipped: { visitId: string; reason: string }[]
}

export interface ClaimBatchDTO {
  id: string
  batchNumber: string
  providerName: string
  periodStart: string
  periodEnd: string
  status: ClaimBatchStatus
  claimCount: number
  claimedTotal: string
  approvedTotal: string
  paidTotal: string
  submittedAt: string | null
  submissionRef: string | null
}

export interface ClaimBatchListResponse {
  page: number
  pageSize: number
  total: number
  rows: ClaimBatchDTO[]
}

export interface ClaimBatchDetailDTO extends ClaimBatchDTO {
  providerId: string
  notes: string | null
  claims: ClaimListItemDTO[]
}

export interface OpenClaimDTO {
  id: string
  claimNumber: string
  patientName: string
  memberNumber: string
  serviceDate: string
  claimedAmount: string
  alreadyPaid: string
  status: ClaimStatus
}

export interface RemittanceAllocationInput {
  claimId: string
  approvedAmount: number
  paidAmount: number
  shortfallAction?: ShortfallAction
  note?: string
}

export interface ClaimRemittanceDTO {
  id: string
  remittanceNumber: string
  providerName: string
  batchNumber: string | null
  receivedAmount: string
  allocatedAmount: string
  reference: string | null
  receivedAt: string
  reversedAt: string | null
  claimCount: number
}

export interface ClaimRemittanceListResponse {
  page: number
  pageSize: number
  total: number
  rows: ClaimRemittanceDTO[]
}

export interface ClaimRemittanceAllocationDTO {
  id: string
  claimId: string
  claimNumber: string
  patientName: string
  approvedAmount: string
  paidAmount: string
  shortfall: string
  shortfallAction: ShortfallAction | null
}

export interface ClaimRemittanceDetailDTO extends ClaimRemittanceDTO {
  providerId: string
  batchId: string | null
  notes: string | null
  reversalReason: string | null
  recordedByName: string | null
  allocations: ClaimRemittanceAllocationDTO[]
}

export interface ClaimsReceivablesRowDTO {
  providerId: string
  providerName: string
  outstanding: string
  aging: ClaimAgingDTO
  approvedUnpaid: string
  rejectedAmount: string
  claimCount: number
}

export interface ClaimsReceivablesDTO {
  rows: ClaimsReceivablesRowDTO[]
  totals: {
    outstanding: string
    aging: ClaimAgingDTO
    approvedUnpaid: string
    rejectedAmount: string
    claimCount: number
  }
}
