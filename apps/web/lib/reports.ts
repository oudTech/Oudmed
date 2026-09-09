import { api } from './api'
import type {
  KpiFormat,
  ReportPaymentsResponse,
  ReportsOverviewDTO,
} from '@oudhealth/contracts'

export {
  REPORT_RANGE_PRESETS,
  REPORT_GRANULARITIES,
  APPOINTMENT_STATUS_SERIES,
} from '@oudhealth/contracts'

type RangeParams = { preset?: string; from?: string; to?: string }

export const reportsApi = {
  overview: (params: RangeParams & { granularity?: string }) =>
    api.get<ReportsOverviewDTO>('/reports/overview', { params }).then((r) => r.data),

  payments: (params: RangeParams & { departmentId?: string; doctorId?: string; page?: number }) =>
    api.get<ReportPaymentsResponse>('/reports/payments', { params }).then((r) => r.data),

  paymentsCsvUrl: '/reports/payments.csv',

  downloadPaymentsCsv: async (
    params: RangeParams & { departmentId?: string; doctorId?: string },
  ) => {
    const res = await api.get('/reports/payments.csv', { params, responseType: 'blob' })
    const url = URL.createObjectURL(res.data as Blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'payment-ledger.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
}

const naira0 = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 })
const naira2 = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 })

export function formatKpi(value: string, format: KpiFormat): string {
  const n = Number(value)
  if (format === 'currency') return '₦' + naira0.format(n)
  if (format === 'percent') return `${n}%`
  return naira0.format(n)
}

export function formatNaira(value: string | number): string {
  return '₦' + naira2.format(Number(value))
}

/** A compact axis tick label: 12k, 3.4m. */
export function shortNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}m`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`
  return String(Math.round(n))
}

export function deltaTone(pct: number): { color: string; bg: string; sign: string } {
  if (pct > 0) return { color: '#047857', bg: '#EAF7F0', sign: '+' }
  if (pct < 0) return { color: '#B42318', bg: '#FEECEB', sign: '' }
  return { color: '#475467', bg: '#F2F4F7', sign: '' }
}
