'use client'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { DrugDTO, DrugUsagePointDTO } from '@oudhealth/contracts'
import { Button, Drawer, Field, Input, Select, Textarea } from '@/components/ui/kit'
import { useConfirm } from '@/components/ui/feedback'
import { can } from '@/lib/permissions'
import { drugsApi, DRUG_FORMS, PACKAGING_TYPES, MOVEMENT_LABEL, expiryTone } from '@/lib/pharmacy'

const naira = (v: string | number) => '₦' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })
const dt = (iso: string) => new Date(iso).toLocaleDateString('en-GB')

export function DrugDetailModal({
  drugId,
  open,
  onClose,
}: {
  drugId: string | null
  open: boolean
  onClose: () => void
}) {
  const { data: session } = useSession()
  const canManage = can(session?.role, 'pharmacy:manage')
  const q = useQuery({
    queryKey: ['drug', drugId],
    queryFn: () => drugsApi.get(drugId!),
    enabled: open && !!drugId,
  })
  const drug = q.data

  return (
    <Drawer open={open} onClose={onClose} title={drug ? drug.name : 'Drug'} width={821}>
      {!drug ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-6">
          <EditForm drug={drug} canManage={canManage} onClose={onClose} />
          {canManage && <StockActions drug={drug} />}
          <BatchList drug={drug} />
          <UsageStats drug={drug} />
          <MovementLog drug={drug} />
        </div>
      )}
    </Drawer>
  )
}

/* ── edit ── */
function EditForm({ drug, canManage, onClose }: { drug: DrugDTO; canManage: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [f, setF] = useState({
    sku: drug.sku, name: drug.name, genericName: drug.genericName ?? '',
    form: drug.form ?? 'Tablet', strength: drug.strength ?? '',
    packaging: drug.packaging, unitLabel: drug.unitLabel ?? '',
    sellPrice: drug.sellPrice, costPrice: drug.costPrice ?? '',
    reorderLevel: String(drug.reorderLevel), comments: drug.comments ?? '',
  })
  useEffect(() => {
    setF({
      sku: drug.sku, name: drug.name, genericName: drug.genericName ?? '',
      form: drug.form ?? 'Tablet', strength: drug.strength ?? '',
      packaging: drug.packaging, unitLabel: drug.unitLabel ?? '',
      sellPrice: drug.sellPrice, costPrice: drug.costPrice ?? '',
      reorderLevel: String(drug.reorderLevel), comments: drug.comments ?? '',
    })
  }, [drug.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }))

  const dirty =
    f.sku !== drug.sku ||
    f.name !== drug.name ||
    f.genericName !== (drug.genericName ?? '') ||
    f.form !== (drug.form ?? 'Tablet') ||
    f.strength !== (drug.strength ?? '') ||
    f.packaging !== drug.packaging ||
    f.unitLabel !== (drug.unitLabel ?? '') ||
    String(f.sellPrice) !== String(drug.sellPrice) ||
    String(f.costPrice) !== String(drug.costPrice ?? '') ||
    f.reorderLevel !== String(drug.reorderLevel) ||
    f.comments !== (drug.comments ?? '')

  const save = useMutation({
    mutationFn: () =>
      drugsApi.update(drug.id, {
        sku: f.sku.trim(),
        name: f.name.trim(),
        genericName: f.genericName.trim() || undefined,
        form: f.form,
        strength: f.strength.trim() || undefined,
        packaging: f.packaging,
        unitLabel: f.unitLabel.trim() || undefined,
        sellPrice: Number(f.sellPrice),
        costPrice: f.costPrice === '' ? null : Number(f.costPrice),
        reorderLevel: Number(f.reorderLevel),
        comments: f.comments.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drug', drug.id] })
      qc.invalidateQueries({ queryKey: ['drugs'] })
      qc.invalidateQueries({ queryKey: ['drug-stats'] })
    },
  })

  const del = useMutation({
    mutationFn: () => drugsApi.remove(drug.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drugs'] })
      qc.invalidateQueries({ queryKey: ['drug-stats'] })
      onClose()
    },
  })

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="SKU"><Input value={f.sku} onChange={(e) => set('sku', e.target.value)} disabled={!canManage} /></Field>
        <Field label="Reorder level"><Input type="number" value={f.reorderLevel} onChange={(e) => set('reorderLevel', e.target.value)} disabled={!canManage} /></Field>
        <Field label="Item name"><Input value={f.name} onChange={(e) => set('name', e.target.value)} disabled={!canManage} /></Field>
        <Field label="Generic name"><Input value={f.genericName} onChange={(e) => set('genericName', e.target.value)} disabled={!canManage} /></Field>
        <Field label="Dosage form">
          <Select value={f.form} onChange={(e) => set('form', e.target.value)} disabled={!canManage}>
            {DRUG_FORMS.map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="Strength"><Input value={f.strength} onChange={(e) => set('strength', e.target.value)} disabled={!canManage} /></Field>
        <Field label="Packaging">
          <Select value={f.packaging} onChange={(e) => set('packaging', e.target.value)} disabled={!canManage}>
            {PACKAGING_TYPES.map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="Unit of issue"><Input value={f.unitLabel} onChange={(e) => set('unitLabel', e.target.value)} disabled={!canManage} /></Field>
        <Field label="Sell price (₦)"><Input type="number" value={f.sellPrice} onChange={(e) => set('sellPrice', e.target.value)} disabled={!canManage} /></Field>
        <Field label="Cost price (₦)"><Input type="number" value={f.costPrice} onChange={(e) => set('costPrice', e.target.value)} disabled={!canManage} /></Field>
      </div>
      <div className="mt-3">
        <Field label="Comments"><Textarea rows={2} value={f.comments} onChange={(e) => set('comments', e.target.value)} disabled={!canManage} /></Field>
      </div>
      {canManage && (
        <div className="flex items-center gap-3 mt-4">
          <Button
            variant="danger"
            loading={del.isPending}
            onClick={async () => {
              if (
                await confirm({
                  title: 'Delete inventory item',
                  body: 'Remove this drug? It is archived instead if it has any stock history.',
                  confirmLabel: 'Delete',
                  danger: true,
                })
              ) {
                del.mutate()
              }
            }}
          >
            Delete inventory item
          </Button>
          <Button
            variant={dirty ? 'primary' : 'secondary'}
            loading={save.isPending}
            disabled={!dirty}
            onClick={() => save.mutate()}
          >
            Update
          </Button>
        </div>
      )}
      {save.isError && <p className="text-sm text-red-600 mt-2">{(save.error as any)?.response?.data?.message ?? 'Could not save.'}</p>}
    </div>
  )
}

/* ── receive / adjust ── */
function StockActions({ drug }: { drug: DrugDTO }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<null | 'receive' | 'adjust'>(null)
  const done = () => {
    qc.invalidateQueries({ queryKey: ['drug', drug.id] })
    qc.invalidateQueries({ queryKey: ['drugs'] })
    qc.invalidateQueries({ queryKey: ['drug-stats'] })
    setMode(null)
  }
  const [rec, setRec] = useState({ quantity: '', expiryDate: '', batchNumber: '', costPrice: '', supplier: '' })
  const [adj, setAdj] = useState({ delta: '', reason: '' })

  const receive = useMutation({
    mutationFn: () =>
      drugsApi.receiveBatch(drug.id, {
        quantity: Number(rec.quantity),
        expiryDate: rec.expiryDate,
        batchNumber: rec.batchNumber.trim() || undefined,
        costPrice: rec.costPrice ? Number(rec.costPrice) : undefined,
        supplier: rec.supplier.trim() || undefined,
      }),
    onSuccess: () => { setRec({ quantity: '', expiryDate: '', batchNumber: '', costPrice: '', supplier: '' }); done() },
  })
  const adjust = useMutation({
    mutationFn: () => drugsApi.adjust(drug.id, { delta: Number(adj.delta), reason: adj.reason.trim() }),
    onSuccess: () => { setAdj({ delta: '', reason: '' }); done() },
  })

  return (
    <div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-500">
          On hand <span className="font-semibold text-gray-900">{drug.quantityOnHand}</span> {drug.unitLabel ?? 'units'}
        </span>
        <button className="text-sm font-medium text-primary hover:underline" onClick={() => setMode(mode === 'receive' ? null : 'receive')}>Receive stock</button>
        <button className="text-sm font-medium text-primary hover:underline" onClick={() => setMode(mode === 'adjust' ? null : 'adjust')}>Adjust</button>
      </div>

      {mode === 'receive' && (
        <div className="rounded-xl border border-gray-100 p-4 mt-3 grid grid-cols-3 gap-3">
          <Field label="Quantity"><Input type="number" value={rec.quantity} onChange={(e) => setRec({ ...rec, quantity: e.target.value })} /></Field>
          <Field label="Expiry date"><Input type="date" value={rec.expiryDate} onChange={(e) => setRec({ ...rec, expiryDate: e.target.value })} /></Field>
          <Field label="Batch no."><Input value={rec.batchNumber} onChange={(e) => setRec({ ...rec, batchNumber: e.target.value })} /></Field>
          <Field label="Cost price (₦)"><Input type="number" value={rec.costPrice} onChange={(e) => setRec({ ...rec, costPrice: e.target.value })} /></Field>
          <Field label="Supplier"><Input value={rec.supplier} onChange={(e) => setRec({ ...rec, supplier: e.target.value })} /></Field>
          <div className="flex items-end">
            <Button loading={receive.isPending} disabled={!rec.quantity || !rec.expiryDate} onClick={() => receive.mutate()}>Receive</Button>
          </div>
          {receive.isError && <p className="col-span-3 text-sm text-red-600">Could not receive stock.</p>}
        </div>
      )}

      {mode === 'adjust' && (
        <div className="rounded-xl border border-gray-100 p-4 mt-3 grid grid-cols-3 gap-3">
          <Field label="Change (+ / -)"><Input type="number" value={adj.delta} onChange={(e) => setAdj({ ...adj, delta: e.target.value })} placeholder="e.g. -5" /></Field>
          <div className="col-span-2">
            <Field label="Reason"><Input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder="Damaged / miscount / expired" /></Field>
          </div>
          <div className="flex items-end">
            <Button loading={adjust.isPending} disabled={!adj.delta || Number(adj.delta) === 0 || adj.reason.trim().length < 2} onClick={() => adjust.mutate()}>Apply</Button>
          </div>
          {adjust.isError && <p className="col-span-3 text-sm text-red-600">{(adjust.error as any)?.response?.data?.message ?? 'Could not adjust.'}</p>}
        </div>
      )}
    </div>
  )
}

/* ── batches ── */
function BatchList({ drug }: { drug: DrugDTO }) {
  if (drug.batches.length === 0) {
    return <p className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl p-4 text-center">No stock batches.</p>
  }
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Batches (earliest expiry first)</p>
      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500">
            <tr>{['Batch', 'Expiry', 'Quantity', 'Supplier'].map((h) => <th key={h} className="text-left font-medium px-3 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {drug.batches.map((b) => {
              const tone = expiryTone(b.daysToExpiry)
              return (
                <tr key={b.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">{b.batchNumber ?? '-'}</td>
                  <td className="px-3 py-2" style={{ color: tone.color }}>{dt(b.expiryDate)} · {tone.label}</td>
                  <td className="px-3 py-2">{b.quantity}</td>
                  <td className="px-3 py-2 text-gray-500">{b.supplier ?? '-'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── usage chart ── */
function UsageStats({ drug }: { drug: DrugDTO }) {
  const [range, setRange] = useState(14)
  const points = useMemo(() => drug.series.slice(-range), [drug.series, range])
  const totalQty = points.reduce((s, p) => s + p.dispensedQty, 0)
  const totalRev = points.reduce((s, p) => s + Number(p.dispensedRevenue), 0)

  return (
    <div className="rounded-xl border border-gray-100 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="font-bold text-gray-900">Dispensing</p>
        <select
          value={range}
          onChange={(e) => setRange(Number(e.target.value))}
          className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>
      <UsageChart points={points} unit={drug.unitLabel ?? 'units'} />
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
          <span className="text-gray-500">Total quantity </span>
          <span className="font-semibold text-gray-900">{totalQty}</span>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
          <span className="text-gray-500">Total revenue </span>
          <span className="font-semibold text-gray-900">{naira(totalRev)}</span>
        </div>
      </div>
    </div>
  )
}

function UsageChart({ points, unit }: { points: DrugUsagePointDTO[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640
  const H = 160
  const padL = 28
  const padB = 20
  const padT = 8
  const max = Math.max(1, ...points.map((p) => p.dispensedQty))
  const plotW = W - padL - 8
  const plotH = H - padB - padT
  const step = plotW / Math.max(1, points.length)
  const barW = Math.max(3, Math.min(22, step - 4))
  const y = (v: number) => padT + plotH - (v / max) * plotH
  const ticks = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i)

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Units dispensed per day, in ${unit}`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - 8} y1={y(v)} y2={y(v)} stroke="#EEF1F5" strokeWidth={1} />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#98A2B3">{v}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const h = plotH - (y(p.dispensedQty) - padT)
          const x = padL + i * step + (step - barW) / 2
          const active = hover === i
          return (
            <rect
              key={p.date}
              x={x}
              y={y(p.dispensedQty)}
              width={barW}
              height={Math.max(p.dispensedQty > 0 ? 2 : 0, h)}
              rx={3}
              fill={active ? '#1E40AF' : '#3366E3'}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          )
        })}
        {points.map((p, i) =>
          i % Math.ceil(points.length / 7) === 0 ? (
            <text key={p.date} x={padL + i * step + step / 2} y={H - 6} textAnchor="middle" fontSize={9} fill="#98A2B3">
              {new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </text>
          ) : null,
        )}
      </svg>
      {hover != null && points[hover] && (
        <div
          className="absolute -top-1 bg-gray-900 text-white text-xs rounded px-2 py-1 pointer-events-none"
          style={{ left: `${(padL + hover * step + step / 2) / W * 100}%`, transform: 'translateX(-50%)' }}
        >
          {new Date(points[hover].date).toLocaleDateString('en-GB')} · {points[hover].dispensedQty} {unit} · {naira(points[hover].dispensedRevenue)}
        </div>
      )}
    </div>
  )
}

/* ── movements ── */
function MovementLog({ drug }: { drug: DrugDTO }) {
  if (drug.movements.length === 0) return null
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Recent stock movements</p>
      <ul className="border border-gray-100 rounded-xl divide-y text-sm">
        {drug.movements.map((m) => (
          <li key={m.id} className="flex items-center justify-between px-3 py-2">
            <span className="text-gray-700">
              {MOVEMENT_LABEL[m.type] ?? m.type}
              {m.reason && <span className="text-gray-400"> · {m.reason}</span>}
              {m.batchNumber && <span className="text-gray-400 font-mono text-xs"> · {m.batchNumber}</span>}
            </span>
            <span className="flex items-center gap-3">
              <span className={m.quantity < 0 ? 'text-red-600' : 'text-green-700'}>
                {m.quantity > 0 ? '+' : ''}{m.quantity}
              </span>
              <span className="text-gray-400 text-xs">{dt(m.createdAt)}{m.createdByName ? ` · ${m.createdByName}` : ''}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
