'use client'
import { useState } from 'react'
import type { ReportPointDTO, ReportWeekdayDTO } from '@oudhealth/contracts'
import { shortNumber } from '@/lib/reports'

/* ─────────────────────────── area / line chart ─────────────────────────── */

export function AreaLineChart({
  points,
  unit = '',
  color = '#5FAF72',
  valueFormat = (v: number) => shortNumber(v),
}: {
  points: ReportPointDTO[]
  unit?: string
  color?: string
  valueFormat?: (v: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 960
  const H = 260
  const padL = 56
  const padR = 16
  const padT = 16
  const padB = 28
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const max = Math.max(1, ...points.map((p) => p.value))
  const niceMax = niceCeil(max)
  const n = Math.max(1, points.length - 1)
  const x = (i: number) => padL + (i / n) * plotW
  const y = (v: number) => padT + plotH - (v / niceMax) * plotH

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ')
  const area = points.length
    ? `${line} L ${x(points.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`
    : ''
  const ticks = [0, niceMax / 2, niceMax]
  const labelEvery = Math.ceil(points.length / 12)

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Time series">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#EEF1F5" strokeWidth={1} />
            <text x={padL - 10} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#98A2B3">
              {v === 0 ? `${unit} 0`.trim() : valueFormat(v)}
            </text>
          </g>
        ))}

        {area && <path d={area} fill={color} fillOpacity={0.12} />}
        {line && <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}

        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={p.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="#98A2B3">
              {p.label}
            </text>
          ) : null,
        )}

        {hover != null && points[hover] && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke="#98A2B3" strokeWidth={1} strokeDasharray="4 4" />
            <circle cx={x(hover)} cy={y(points[hover].value)} r={4} fill={color} stroke="#fff" strokeWidth={2} />
          </>
        )}

        {points.map((p, i) => (
          <rect
            key={p.date}
            x={x(i) - plotW / n / 2}
            y={padT}
            width={Math.max(6, plotW / n)}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      {hover != null && points[hover] && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-center shadow-sm"
          style={{ left: `${(x(hover) / W) * 100}%`, top: 8 }}
        >
          <p className="text-xs text-gray-400">{points[hover].label}</p>
          <p className="text-sm font-semibold text-gray-800">
            {unit ? `${unit} ` : ''}
            {valueFormat(points[hover].value)}
          </p>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────── horizontal bar list ─────────────────────────── */

export function HBarList({
  rows,
  from = '#3B82F6',
  to = '#BFDBFE',
  selectedId,
  onSelect,
  formatValue,
}: {
  rows: { id: string | null; label: string; value: number }[]
  from?: string
  to?: string
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  formatValue?: (v: number) => string
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (!rows.length) {
    return <p className="text-sm text-gray-400 py-6">No revenue in this period.</p>
  }
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const active = selectedId === r.id
        const dim = selectedId != null && !active
        return (
          <button
            key={r.id ?? r.label}
            type="button"
            onClick={() => onSelect?.(active ? null : r.id)}
            disabled={!onSelect}
            className={`block w-full text-left transition ${dim ? 'opacity-40' : ''} ${onSelect ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <div className="flex items-baseline justify-between text-sm">
              <span className={`${active ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{r.label}</span>
              {formatValue && <span className="text-xs text-gray-400">{formatValue(r.value)}</span>}
            </div>
            <div className="mt-1 h-3.5 w-full rounded-full bg-gray-50">
              <div
                className="h-3.5 rounded-full"
                style={{
                  width: `${Math.max(4, (r.value / max) * 100)}%`,
                  background: `linear-gradient(90deg, ${from}, ${to})`,
                  outline: active ? `2px solid ${from}` : 'none',
                  outlineOffset: 1,
                }}
              />
            </div>
          </button>
        )
      })}
    </div>
  )
}

/* ─────────────────────────── stacked bar chart ─────────────────────────── */

type SeriesKey = 'completed' | 'scheduled' | 'checkedIn' | 'missed'

export function StackedBarChart({
  rows,
  series,
}: {
  rows: ReportWeekdayDTO[]
  series: readonly { key: string; label: string; color: string }[]
}) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 960
  const H = 300
  const padL = 44
  const padR = 12
  const padT = 12
  const padB = 28
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const totals = rows.map((r) => r.completed + r.scheduled + r.checkedIn + r.missed)
  const niceMax = niceCeil(Math.max(1, ...totals))
  const step = plotW / Math.max(1, rows.length)
  const barW = Math.min(64, step * 0.5)
  const y = (v: number) => padT + plotH - (v / niceMax) * plotH
  const ticks = [0, niceMax / 4, niceMax / 2, (niceMax * 3) / 4, niceMax]

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Appointments by weekday">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#EEF1F5" strokeWidth={1} />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#98A2B3">
              {Math.round(v)}
            </text>
          </g>
        ))}

        {rows.map((r, i) => {
          const cx = padL + i * step + step / 2
          let acc = 0
          return (
            <g key={r.weekday} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {series.map((s) => {
                const val = (r[s.key as SeriesKey] as number) ?? 0
                const h = (val / niceMax) * plotH
                const yTop = y(acc + val)
                acc += val
                return h > 0 ? (
                  <rect key={s.key} x={cx - barW / 2} y={yTop} width={barW} height={h} fill={s.color} opacity={hover == null || hover === i ? 1 : 0.5} />
                ) : null
              })}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="#98A2B3">{r.weekday}</text>
            </g>
          )
        })}
      </svg>

      {hover != null && rows[hover] && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm"
          style={{ left: `${((padL + hover * step + step / 2) / W) * 100}%`, top: 8 }}
        >
          <p className="mb-1 font-semibold text-gray-800">{rows[hover].weekday}</p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center gap-1.5 text-gray-600">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}: {(rows[hover][s.key as SeriesKey] as number) ?? 0}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function niceCeil(v: number): number {
  if (v <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const norm = v / mag
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return step * mag
}
