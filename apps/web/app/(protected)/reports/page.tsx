'use client'
import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { ReportKpiDTO } from '@oudhealth/contracts'
import { can } from '@/lib/permissions'
import {
  reportsApi,
  formatKpi,
  formatNaira,
  deltaTone,
  shortNumber,
  REPORT_RANGE_PRESETS,
  REPORT_GRANULARITIES,
  APPOINTMENT_STATUS_SERIES,
} from '@/lib/reports'
import { AreaLineChart, HBarList, StackedBarChart } from '@/components/reports/charts'
import { PaymentLedger } from '@/components/reports/PaymentLedger'
import { FeatureCallout } from '@/components/onboarding'

type BarFilter = { kind: 'department' | 'doctor'; id: string; label: string } | null

export default function ReportsPage() {
  const { data: session } = useSession()
  const allowed = can(session?.role, 'reports:view')

  const [preset, setPreset] = useState('this_month')
  const [granularity, setGranularity] = useState('monthly')
  const [filter, setFilter] = useState<BarFilter>(null)

  const overview = useQuery({
    queryKey: ['report-overview', preset, granularity],
    queryFn: () => reportsApi.overview({ preset, granularity }),
    enabled: allowed,
    placeholderData: keepPreviousData,
  })

  if (!allowed) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Reports</h1>
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6">
          Reports are available to hospital admins and accountants.
        </p>
      </div>
    )
  }

  const d = overview.data
  const range = { preset }

  return (
    <div className="flex flex-col h-full bg-[#F7F9FC] overflow-hidden">
      <div className="px-8 pt-7 pb-4 flex items-center justify-between flex-shrink-0 bg-white border-b border-[#D6DEE8]">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {d ? d.range.label : 'Loading…'}
            {d?.range.comparedTo && ' · compared with the preceding period'}
          </p>
        </div>
        <select
          value={preset}
          onChange={(e) => { setPreset(e.target.value); setFilter(null) }}
          data-tour="reports-range"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
        >
          {REPORT_RANGE_PRESETS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {/* ── financial KPIs ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {(d?.finance ?? skeleton(4)).map((k, i) => <KpiTile key={k?.key ?? i} kpi={k} />)}
        </div>

        {/* ── operational KPIs ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {(d?.operations ?? skeleton(8)).map((k, i) => <KpiTile key={k?.key ?? i} kpi={k} />)}
        </div>

        {/* ── collections over time ── */}
        <Card title="Collections over time" subtitle="Payments received, net of reversals">
          {d ? (
            <AreaLineChart
              points={d.collections}
              unit={d.collectionsUnit}
              valueFormat={(v) => shortNumber(v)}
            />
          ) : <ChartSkeleton />}
        </Card>

        {/* ── revenue breakdowns ── */}
        <div className="grid lg:grid-cols-2 gap-6">
          <Card title="Revenue by department" subtitle="Click a bar to filter the ledger below">
            {d ? (
              <HBarList
                rows={d.revenueByDepartment}
                from="#3B82F6"
                to="#BFDBFE"
                selectedId={filter?.kind === 'department' ? filter.id : null}
                formatValue={(v) => formatNaira(v)}
                onSelect={(id) =>
                  setFilter(id
                    ? { kind: 'department', id, label: d.revenueByDepartment.find((r) => r.id === id)?.label ?? 'Department' }
                    : null)
                }
              />
            ) : <ChartSkeleton short />}
          </Card>
          <Card title="Revenue by doctor" subtitle="Click a bar to filter the ledger below">
            {d ? (
              <HBarList
                rows={d.revenueByDoctor}
                from="#5FAF72"
                to="#CDE9D4"
                selectedId={filter?.kind === 'doctor' ? filter.id : null}
                formatValue={(v) => formatNaira(v)}
                onSelect={(id) =>
                  setFilter(id
                    ? { kind: 'doctor', id, label: d.revenueByDoctor.find((r) => r.id === id)?.label ?? 'Doctor' }
                    : null)
                }
              />
            ) : <ChartSkeleton short />}
          </Card>
        </div>

        {/* ── patient analytics ── */}
        <Card
          title="Patient analytics"
          subtitle="New patient registrations"
          action={
            <div className="flex rounded-full bg-gray-100 p-1 text-sm">
              {REPORT_GRANULARITIES.map((g) => (
                <button
                  key={g.value}
                  onClick={() => setGranularity(g.value)}
                  className={`rounded-full px-3 py-1 font-medium transition ${
                    granularity === g.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          }
        >
          {d ? <AreaLineChart points={d.patientTrend} valueFormat={(v) => String(Math.round(v))} /> : <ChartSkeleton />}
        </Card>

        {/* ── patient mix ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(d?.patientMix ?? skeleton(8)).map((k, i) => <MixPill key={k?.key ?? i} kpi={k} />)}
        </div>

        {/* ── appointments by weekday ── */}
        <Card title="Appointments by weekday" subtitle="Every appointment in the period, by day and outcome">
          <div className="mb-3 flex flex-wrap gap-4">
            {APPOINTMENT_STATUS_SERIES.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5 text-sm text-gray-600">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
          {d ? <StackedBarChart rows={d.appointmentsByWeekday} series={APPOINTMENT_STATUS_SERIES} /> : <ChartSkeleton />}
        </Card>

        {/* ── payment ledger ── */}
        <FeatureCallout
          id="reports-csv-export"
          title="Export to CSV"
          body="Use Export on the payment ledger below to download the filtered rows as a spreadsheet for your own reconciliation or board pack."
        />
        <PaymentLedger range={range} filter={filter} onClearFilter={() => setFilter(null)} />
      </div>
    </div>
  )
}

/* ─────────────────────────── pieces ─────────────────────────── */

function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

function KpiTile({ kpi }: { kpi: ReportKpiDTO | null }) {
  if (!kpi) return <div className="h-[104px] rounded-xl border border-gray-100 bg-white animate-pulse" />
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <p className="text-sm text-gray-500">{kpi.label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{formatKpi(kpi.value, kpi.format)}</p>
      <div className="mt-1 text-xs">
        {kpi.deltaPct != null ? (
          <span className="text-gray-400">
            <DeltaChip pct={kpi.deltaPct} /> vs previous period
          </span>
        ) : (
          <span className="text-gray-400">{kpi.hint ?? ' '}</span>
        )}
      </div>
    </div>
  )
}

function MixPill({ kpi }: { kpi: ReportKpiDTO | null }) {
  if (!kpi) return <div className="h-14 rounded-xl bg-gray-100 animate-pulse" />
  return (
    <div className="flex items-center justify-between rounded-xl bg-[#F1F4F9] px-5 py-4">
      <span className="text-sm text-gray-700">{kpi.label}</span>
      <span className="text-lg font-bold text-gray-900">
        {formatKpi(kpi.value, kpi.format)}
        {kpi.deltaPct != null && (
          <span className="ml-1.5 text-sm font-medium" style={{ color: deltaTone(kpi.deltaPct).color }}>
            ({deltaTone(kpi.deltaPct).sign}{kpi.deltaPct}%)
          </span>
        )}
      </span>
    </div>
  )
}

function DeltaChip({ pct }: { pct: number }) {
  const t = deltaTone(pct)
  return (
    <span className="rounded-full px-1.5 py-0.5 font-semibold" style={{ color: t.color, backgroundColor: t.bg }}>
      {t.sign}{pct}%
    </span>
  )
}

function ChartSkeleton({ short }: { short?: boolean }) {
  return <div className={`w-full ${short ? 'h-40' : 'h-64'} rounded-xl bg-gray-50 animate-pulse`} />
}

function skeleton(n: number): null[] {
  return Array.from({ length: n }, () => null)
}
