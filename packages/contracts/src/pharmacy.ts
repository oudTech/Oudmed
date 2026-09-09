export type StockStatus = 'OK' | 'LOW' | 'OUT'
export type StockMovementType =
  | 'OPENING'
  | 'RECEIVE'
  | 'DISPENSE'
  | 'ADJUST'
  | 'RETURN'
  | 'WASTE'

export const DRUG_FORMS = [
  'Tablet',
  'Capsule',
  'Syrup',
  'Suspension',
  'Injection',
  'Ampoule',
  'Vial',
  'Cream',
  'Ointment',
  'Drops',
  'Inhaler',
  'Suppository',
  'Sachet',
  'Other',
] as const

export const PACKAGING_TYPES = [
  'Pack',
  'Bottle',
  'Tube',
  'Blister',
  'Vial',
  'Ampoule',
  'Sachet',
  'Each',
] as const

export interface DrugListItemDTO {
  id: string
  sku: string
  name: string
  genericName: string | null
  form: string | null
  strength: string | null
  packaging: string
  unitLabel: string | null
  sellPrice: string
  costPrice: string | null
  reorderLevel: number
  quantityOnHand: number
  stockStatus: StockStatus
  nearestExpiry: string | null
  expiringSoon: boolean
  isActive: boolean
}

export interface DrugListResponse {
  page: number
  pageSize: number
  total: number
  drugs: DrugListItemDTO[]
}

export interface DrugStatDTO {
  total: number
  addedThisMonth?: number
}
export interface DrugStatsResponse {
  totalDrugs: DrugStatDTO
  lowStock: DrugStatDTO
  outOfStock: DrugStatDTO
  expiringSoon: DrugStatDTO
}

export interface DrugBatchDTO {
  id: string
  batchNumber: string | null
  expiryDate: string
  quantity: number
  costPrice: string | null
  supplier: string | null
  receivedAt: string
  expired: boolean
  daysToExpiry: number
}

export interface StockMovementDTO {
  id: string
  type: StockMovementType
  quantity: number
  unitPrice: string | null
  reason: string | null
  batchNumber: string | null
  createdByName: string | null
  createdAt: string
}

export interface DrugUsagePointDTO {
  date: string // YYYY-MM-DD
  dispensedQty: number
  dispensedRevenue: string
  receivedQty: number
}

export interface DrugDTO extends DrugListItemDTO {
  comments: string | null
  createdAt: string
  updatedAt: string
  batches: DrugBatchDTO[]
  movements: StockMovementDTO[]
  series: DrugUsagePointDTO[]
}

export interface DrugSearchItemDTO {
  id: string
  name: string
  form: string | null
  strength: string | null
  sellPrice: string
  quantityOnHand: number
}

export interface DrugImportResultDTO {
  created: number
  updated: number
  skipped: number
  errors: { row: number; message: string }[]
}
