import { api } from './api'
import type {
  DrugDTO,
  DrugImportResultDTO,
  DrugListResponse,
  DrugSearchItemDTO,
  DrugStatsResponse,
} from '@oudhealth/contracts'

export { DRUG_FORMS, PACKAGING_TYPES } from '@oudhealth/contracts'

export const drugsApi = {
  list: (params: { search?: string; filter?: string; page?: number }) =>
    api.get<DrugListResponse>('/pharmacy/drugs', { params }).then((r) => r.data),
  stats: () => api.get<DrugStatsResponse>('/pharmacy/drugs/stats').then((r) => r.data),
  get: (id: string) => api.get<DrugDTO>(`/pharmacy/drugs/${id}`).then((r) => r.data),
  search: (q: string) =>
    api.get<DrugSearchItemDTO[]>('/pharmacy/drugs/search', { params: { q } }).then((r) => r.data),
  create: (data: Record<string, unknown>) =>
    api.post<DrugDTO>('/pharmacy/drugs', data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch<DrugDTO>(`/pharmacy/drugs/${id}`, data).then((r) => r.data),
  remove: (id: string) => api.delete(`/pharmacy/drugs/${id}`).then((r) => r.data),
  receiveBatch: (id: string, data: Record<string, unknown>) =>
    api.post<DrugDTO>(`/pharmacy/drugs/${id}/batches`, data).then((r) => r.data),
  adjust: (id: string, data: { delta: number; reason: string }) =>
    api.post<DrugDTO>(`/pharmacy/drugs/${id}/adjust`, data).then((r) => r.data),
  importDrugs: (rows: Record<string, unknown>[]) =>
    api.post<DrugImportResultDTO>('/pharmacy/drugs/import', { rows }).then((r) => r.data),
}

export const STOCK_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  OK: { label: 'In stock', color: '#047857', bg: '#EAF7F0' },
  LOW: { label: 'Low stock', color: '#B45309', bg: '#FFF6E5' },
  OUT: { label: 'Out of stock', color: '#B42318', bg: '#FEECEB' },
}

export const MOVEMENT_LABEL: Record<string, string> = {
  OPENING: 'Opening balance',
  RECEIVE: 'Stock received',
  DISPENSE: 'Dispensed',
  ADJUST: 'Adjustment',
  RETURN: 'Returned',
  WASTE: 'Written off',
}

/** Colour an expiry by how close it is. */
export function expiryTone(days: number): { color: string; label: string } {
  if (days < 0) return { color: '#B42318', label: 'Expired' }
  if (days <= 30) return { color: '#B42318', label: `${days}d left` }
  if (days <= 90) return { color: '#B45309', label: `${days}d left` }
  return { color: '#475467', label: new Date(Date.now() + days * 86_400_000).toLocaleDateString('en-GB') }
}

/** Minimal quote-aware CSV parser -> array of row objects keyed by header. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((x) => x.trim() !== '')) rows.push(row) }
  if (!rows.length) return []
  const headers = rows[0].map((h) => h.trim())
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {}
    headers.forEach((h, idx) => { o[h] = (r[idx] ?? '').trim() })
    return o
  })
}

export const IMPORT_TEMPLATE = [
  'sku,name,genericName,form,strength,packaging,unitLabel,sellPrice,costPrice,reorderLevel,openingQuantity,expiryDate,batchNumber',
  ',Paracetamol,Paracetamol,Tablet,500 mg,Blister,tablet,20,12,300,2000,2027-06-30,PCM-2401',
  ',Amoxicillin,Amoxicillin,Capsule,500 mg,Blister,capsule,45,28,120,500,2026-12-31,AMX-77',
].join('\n')
