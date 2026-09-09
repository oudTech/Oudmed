export type KpiFormat = 'currency' | 'number' | 'percent'

export type ReportGranularity = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface ReportKpiDTO {
  key: string
  label: string
  /** Numeric string; `format` tells the UI how to render it. */
  value: string
  format: KpiFormat
  /** null renders as "N/A vs previous period". */
  deltaPct: number | null
  hint?: string
}

export interface ReportPointDTO {
  date: string
  label: string
  value: number
}

export interface ReportBarDTO {
  id: string | null
  label: string
  value: number
}

export interface ReportWeekdayDTO {
  weekday: string
  completed: number
  scheduled: number
  checkedIn: number
  missed: number
}

export interface ReportsOverviewDTO {
  range: { from: string; to: string; label: string; comparedTo: string | null }
  finance: ReportKpiDTO[]
  operations: ReportKpiDTO[]
  collections: ReportPointDTO[]
  collectionsUnit: string
  revenueByDepartment: ReportBarDTO[]
  revenueByDoctor: ReportBarDTO[]
  patientTrend: ReportPointDTO[]
  patientTrendGranularity: ReportGranularity
  patientMix: ReportKpiDTO[]
  appointmentsByWeekday: ReportWeekdayDTO[]
}

export interface ReportPaymentRowDTO {
  id: string
  paidAt: string
  invoiceId: string
  invoiceNumber: string
  patientName: string
  amount: string
  method: string
  paidBy: string
  cashier: string | null
  comment: string | null
  status: 'Success' | 'Reversed'
  reversedAt: string | null
}

export interface ReportPaymentsResponse {
  page: number
  pageSize: number
  total: number
  totalAmount: string
  rows: ReportPaymentRowDTO[]
}

export const REPORT_RANGE_PRESETS: { value: string; label: string }[] = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_30', label: 'Last 30 days' },
  { value: 'last_90', label: 'Last 90 days' },
  { value: 'this_year', label: 'This year' },
]

export const REPORT_GRANULARITIES: { value: ReportGranularity; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

export const APPOINTMENT_STATUS_SERIES = [
  { key: 'completed', label: 'Completed', color: '#5FAF72' },
  { key: 'scheduled', label: 'Scheduled', color: '#F5C24B' },
  { key: 'checkedIn', label: 'Checked in', color: '#7FA9E8' },
  { key: 'missed', label: 'Missed', color: '#E86F6F' },
] as const
