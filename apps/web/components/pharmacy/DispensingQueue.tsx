'use client'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { PharmacyQueueItemDTO } from '@oudhealth/contracts'
import { Button, Field, Modal, Textarea } from '@/components/ui/kit'
import { can } from '@/lib/permissions'
import { pharmacyApi, DISPENSE_STATUS_META } from '@/lib/encounters'

const d = (iso: string) => new Date(iso).toLocaleDateString('en-GB')

export function DispensingQueue() {
  const { data: session } = useSession()
  const canDispense = can(session?.role, 'prescription:dispense')
  const [status, setStatus] = useState('PENDING')
  const [active, setActive] = useState<PharmacyQueueItemDTO | null>(null)

  const q = useQuery({
    queryKey: ['pharmacy-queue', status],
    queryFn: () => pharmacyApi.queue(status === 'ALL' ? undefined : status),
  })

  return (
    <div className="p-8">
      <div className="flex gap-2 mb-5">
        {[
          ['PENDING', 'Awaiting'],
          ['PARTIAL', 'Part dispensed'],
          ['DISPENSED', 'Dispensed'],
          ['ALL', 'All'],
        ].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setStatus(v)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${status === v ? 'bg-blue-50 text-primary' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {!q.data ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : q.data.length === 0 ? (
        <p className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl p-6 text-center">
          Nothing in this list.
        </p>
      ) : (
        <div className="border border-gray-100 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                {['Date', 'Patient', 'Medicines', 'Prescriber', 'Status', ''].map((h) => (
                  <th key={h} className="text-left font-medium px-3 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.map((rx) => {
                const dm = DISPENSE_STATUS_META[rx.dispenseStatus]
                return (
                  <tr key={rx.id} className="border-t border-gray-100">
                    <td className="px-3 py-2.5 text-gray-500">{d(rx.prescribedAt)}</td>
                    <td className="px-3 py-2.5">
                      {rx.patient.firstName} {rx.patient.lastName}
                      <span className="text-gray-400 text-xs ml-1">{rx.patient.patientNumber}</span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-700">{rx.items.map((it) => it.drugName).join(', ')}</td>
                    <td className="px-3 py-2.5 text-gray-500">{rx.prescribedByName ?? '-'}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: dm.color, backgroundColor: dm.bg }}>
                        {dm.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {canDispense && (rx.dispenseStatus === 'PENDING' || rx.dispenseStatus === 'PARTIAL') && (
                        <button className="text-sm font-semibold text-primary hover:underline" onClick={() => setActive(rx)}>
                          Dispense
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <DispenseModal rx={active} open={!!active} onClose={() => setActive(null)} />
    </div>
  )
}

function DispenseModal({
  rx,
  open,
  onClose,
}: {
  rx: PharmacyQueueItemDTO | null
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [lines, setLines] = useState<Record<string, { quantity: string; unitPrice: string }>>({})
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  const rows = useMemo(
    () =>
      (rx?.items ?? []).map((it) => ({
        it,
        quantity: lines[it.id]?.quantity ?? String(it.dispensedQty ?? ''),
        unitPrice:
          lines[it.id]?.unitPrice ?? (it.dispenseUnitPrice ?? it.sellPrice ?? ''),
      })),
    [rx, lines],
  )

  const set = (id: string, k: 'quantity' | 'unitPrice', v: string) =>
    setLines((s) => ({
      ...s,
      [id]: { quantity: s[id]?.quantity ?? '', unitPrice: s[id]?.unitPrice ?? '', [k]: v },
    }))

  const total = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0), 0)

  const m = useMutation({
    mutationFn: () =>
      pharmacyApi.dispense(rx!.id, {
        items: rows.map((r) => ({
          itemId: r.it.id,
          quantity: Number(r.quantity) || 0,
          unitPrice: Number(r.unitPrice) || 0,
        })),
        note: note || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pharmacy-queue'] })
      qc.invalidateQueries({ queryKey: ['drugs'] })
      setLines({}); setNote(''); setErr('')
      onClose()
    },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not record the dispense.'),
  })

  if (!rx) return null
  return (
    <Modal open={open} onClose={onClose} title={`Dispense · ${rx.patient.firstName} ${rx.patient.lastName}`} width={680} align="center">
      <div className="space-y-3">
        <div className="border border-gray-100 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                {['Drug', 'Directions', 'On hand', 'Qty', 'Unit ₦', 'Line ₦'].map((h) => (
                  <th key={h} className="text-left font-medium px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const onHand = r.it.quantityOnHand
                const short = onHand != null && Number(r.quantity) > onHand
                return (
                  <tr key={r.it.id} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      <span className="font-medium text-gray-900">{r.it.drugName}</span>
                      {r.it.strengthConc && <span className="text-gray-400 text-xs ml-1">{r.it.strengthConc}</span>}
                      {!r.it.drugId && <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600">off-formulary</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {[r.it.amountPerUse, r.it.frequency, r.it.durationNumber ? `${r.it.durationNumber} ${(r.it.durationType ?? 'days').toLowerCase()}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </td>
                    <td className={`px-3 py-2 text-xs ${short ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                      {onHand != null ? onHand : '-'}
                      {short && <span className="block">short by {Number(r.quantity) - onHand!}</span>}
                    </td>
                    <td className="px-3 py-2 w-20">
                      <input
                        type="number"
                        className={`border rounded-md px-2 py-1 w-16 text-sm ${short ? 'border-red-300' : 'border-gray-200'}`}
                        value={r.quantity}
                        onChange={(e) => set(r.it.id, 'quantity', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2 w-24">
                      <input
                        type="number"
                        className="border border-gray-200 rounded-md px-2 py-1 w-20 text-sm"
                        value={r.unitPrice}
                        onChange={(e) => set(r.it.id, 'unitPrice', e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      ₦{((Number(r.quantity) || 0) * (Number(r.unitPrice) || 0)).toLocaleString()}
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                <td className="px-3 py-2" colSpan={5}>Total charge</td>
                <td className="px-3 py-2">₦{total.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400">
          Formulary items draw stock earliest-expiry first. Items left at quantity 0 stay pending. Charges
          post to the visit invoice (or a new pharmacy invoice if there is no visit).
        </p>
        <Field label="Note">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Counselling / substitution notes" />
        </Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={m.isPending}
            disabled={!rows.some((r) => Number(r.quantity) > 0)}
            onClick={() => m.mutate()}
          >
            Confirm dispense
          </Button>
        </div>
      </div>
    </Modal>
  )
}
