'use client'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { PharmacyQueueItemDTO } from '@oudhealth/contracts'
import { Button, Field, Modal, Textarea } from '@/components/ui/kit'
import { useToast } from '@/components/ui/feedback'
import { can } from '@/lib/permissions'
import { pharmacyApi, DISPENSE_STATUS_META } from '@/lib/encounters'
import { settingsApi } from '@/lib/settings'
import { naira } from '@/lib/billing'

const d = (iso: string) => new Date(iso).toLocaleDateString('en-GB')

export function DispensingQueue() {
  const { data: session } = useSession()
  const canDispense = can(session?.role, 'prescription:dispense')
  const [status, setStatus] = useState('PENDING')
  const [active, setActive] = useState<PharmacyQueueItemDTO | null>(null)
  const [releasing, setReleasing] = useState<PharmacyQueueItemDTO | null>(null)

  const settings = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get })
  const gateOn = settings.data?.requirePaymentBeforeDispense ?? false

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
          ...(gateOn ? [['AWAITING_PAYMENT', 'Awaiting payment']] : []),
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
                const awaitingPayment = rx.dispenseStatus === 'AWAITING_PAYMENT'
                const allReady = awaitingPayment && rx.items.every((it) => it.preparedQty === 0 || it.preparedInvoicePaid !== false)
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
                        {awaitingPayment && allReady ? 'Paid - ready to dispense' : dm.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {canDispense && (rx.dispenseStatus === 'PENDING' || rx.dispenseStatus === 'PARTIAL') && (
                        <button className="text-sm font-semibold text-primary hover:underline" onClick={() => setActive(rx)}>
                          {gateOn ? 'Prepare' : 'Dispense'}
                        </button>
                      )}
                      {canDispense && awaitingPayment && (
                        <button className="text-sm font-semibold text-primary hover:underline" onClick={() => setReleasing(rx)}>
                          Review
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

      <DispenseModal rx={active} gateOn={gateOn} open={!!active} onClose={() => setActive(null)} />
      <ReleaseModal rx={releasing} open={!!releasing} onClose={() => setReleasing(null)} />
    </div>
  )
}

function ReleaseModal({
  rx,
  open,
  onClose,
}: {
  rx: PharmacyQueueItemDTO | null
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [cancelling, setCancelling] = useState<{ itemId: string; drugName: string } | null>(null)
  const [reason, setReason] = useState('')

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['pharmacy-queue'] })
    qc.invalidateQueries({ queryKey: ['drugs'] })
  }

  const release = useMutation({
    mutationFn: () => pharmacyApi.release(rx!.id),
    onSuccess: (res) => {
      invalidate()
      if (res.released.length && !res.stillAwaiting.length) {
        toast('Released - stock drawn, ready for the patient', 'success')
        onClose()
      } else if (res.released.length) {
        toast(`${res.released.length} item(s) released; ${res.stillAwaiting.length} still awaiting payment`, 'success')
      } else {
        toast('Nothing was ready to release yet', 'error')
      }
    },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not release.', 'error'),
  })

  const cancelPrep = useMutation({
    mutationFn: () => pharmacyApi.cancelPreparation(rx!.id, cancelling!.itemId, reason.trim()),
    onSuccess: () => { invalidate(); setCancelling(null); setReason('') },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not cancel the preparation.', 'error'),
  })

  if (!rx) return null
  const prepared = rx.items.filter((it) => it.preparedQty > 0)
  const anyReady = prepared.some((it) => it.preparedInvoicePaid !== false)

  return (
    <Modal open={open} onClose={onClose} title={`Review · ${rx.patient.firstName} ${rx.patient.lastName}`} width={560} align="center">
      <div className="space-y-3">
        <p className="text-sm text-gray-500">
          Awaiting payment - the full invoice balance must be cleared, including any other charges on it, before
          these items can be released.
        </p>
        <div className="border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-100">
          {prepared.map((it) => {
            const ready = it.preparedInvoicePaid !== false
            const isCancelling = cancelling?.itemId === it.id
            return (
              <div key={it.id} className="px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{it.drugName}{it.strengthConc ? ` ${it.strengthConc}` : ''}</p>
                    <p className="text-xs text-gray-400">
                      {it.preparedQty} prepared {it.preparedUnitPrice ? `at ${naira(Number(it.preparedUnitPrice))} each` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className="text-xs font-medium rounded-full px-2 py-0.5"
                      style={ready ? { color: '#047857', backgroundColor: '#EAF7F0' } : { color: '#B45309', backgroundColor: '#FFF6E5' }}
                    >
                      {ready ? 'Paid - ready' : 'Awaiting payment'}
                    </span>
                    <button
                      className="text-xs text-gray-400 hover:text-red-500"
                      onClick={() => {
                        setReason('')
                        setCancelling(isCancelling ? null : { itemId: it.id, drugName: it.drugName })
                      }}
                    >
                      {isCancelling ? 'Back' : 'Cancel'}
                    </button>
                  </div>
                </div>
                {isCancelling && (
                  <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
                    <p className="text-xs text-gray-500">
                      Voids the charge for {it.drugName} - nothing was ever drawn from stock for it.
                    </p>
                    <Field label="Reason" required>
                      <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </Field>
                    <div className="flex justify-end">
                      <Button
                        variant="danger"
                        loading={cancelPrep.isPending}
                        disabled={reason.trim().length < 2}
                        onClick={() => cancelPrep.mutate()}
                      >
                        Confirm cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button loading={release.isPending} disabled={!anyReady} onClick={() => release.mutate()}>
            Release ready items
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function DispenseModal({
  rx,
  gateOn,
  open,
  onClose,
}: {
  rx: PharmacyQueueItemDTO | null
  gateOn: boolean
  open: boolean
  onClose: () => void
}) {
  const { data: session } = useSession()
  const canOverridePrice = can(session?.role, 'billing:manage')
  const canEmergencyOverride = can(session?.role, 'pharmacy:dispense-emergency-override')
  const qc = useQueryClient()
  const [lines, setLines] = useState<
    Record<string, { quantity: string; unitPrice: string; overriding: boolean; overrideReason: string }>
  >({})
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [emergency, setEmergency] = useState(false)
  const [emergencyReason, setEmergencyReason] = useState('')

  const rows = useMemo(
    () =>
      (rx?.items ?? []).map((it) => {
        const catalogueOr = it.dispenseUnitPrice ?? it.sellPrice ?? ''
        const line = lines[it.id]
        const baseline = (it.dispensedQty ?? 0) + (it.preparedQty ?? 0)
        return {
          it,
          quantity: line?.quantity ?? (baseline > 0 ? String(baseline) : ''),
          // Off-formulary items have no catalogue price to lock to - stays freely editable, unchanged behavior.
          unitPrice: it.drugId ? (line?.overriding ? (line?.unitPrice ?? catalogueOr) : catalogueOr) : (line?.unitPrice ?? catalogueOr),
          overriding: line?.overriding ?? false,
          overrideReason: line?.overrideReason ?? '',
        }
      }),
    [rx, lines],
  )

  const LINE_DEFAULTS = { quantity: '', unitPrice: '', overriding: false, overrideReason: '' }
  const set = (id: string, patch: Partial<{ quantity: string; unitPrice: string; overriding: boolean; overrideReason: string }>) =>
    setLines((s) => ({
      ...s,
      [id]: { ...LINE_DEFAULTS, ...s[id], ...patch },
    }))

  const total = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0), 0)
  const needsReason = (r: (typeof rows)[number]) =>
    Number(r.quantity) > 0 && (!r.it.drugId || r.overriding) && !r.overrideReason.trim()

  const itemsPayload = () =>
    rows.map((r) => ({
      itemId: r.it.id,
      quantity: Number(r.quantity) || 0,
      // Only send a price when actually overriding (formulary) or for an
      // off-formulary item (no catalogue to resolve server-side, always
      // needs a reason); otherwise let the server resolve and charge the
      // catalogue price.
      ...(r.it.drugId
        ? r.overriding
          ? { unitPrice: Number(r.unitPrice) || 0, overrideReason: r.overrideReason }
          : {}
        : { unitPrice: Number(r.unitPrice) || 0, overrideReason: r.overrideReason }),
    }))

  const reset = () => { setLines({}); setNote(''); setErr(''); setEmergency(false); setEmergencyReason('') }

  const m = useMutation({
    mutationFn: () =>
      gateOn && !emergency
        ? pharmacyApi.prepare(rx!.id, { items: itemsPayload(), note: note || undefined })
        : pharmacyApi.dispense(rx!.id, {
            items: itemsPayload(),
            note: note || undefined,
            ...(emergency ? { emergencyOverride: true, emergencyReason: emergencyReason.trim() } : {}),
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pharmacy-queue'] })
      qc.invalidateQueries({ queryKey: ['drugs'] })
      reset()
      onClose()
    },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not record this.'),
  })

  if (!rx) return null
  const title = gateOn && !emergency ? 'Prepare' : 'Dispense'
  return (
    <Modal open={open} onClose={onClose} title={`${title} · ${rx.patient.firstName} ${rx.patient.lastName}`} width={680} align="center">
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
                      {!r.it.drugId && (
                        <span
                          className="ml-2 text-[10px] uppercase tracking-wide text-amber-600"
                          title="Not in the pharmacy catalogue - does not affect stock levels"
                        >
                          off-formulary
                        </span>
                      )}
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
                        onChange={(e) => set(r.it.id, { quantity: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2 w-28">
                      {!r.it.drugId || (canOverridePrice && r.overriding) ? (
                        <div className="space-y-1">
                          <input
                            type="number"
                            className="border border-gray-200 rounded-md px-2 py-1 w-24 text-sm"
                            value={r.unitPrice}
                            onChange={(e) => set(r.it.id, { unitPrice: e.target.value })}
                          />
                          <input
                            type="text"
                            className="border border-gray-200 rounded-md px-2 py-1 w-24 text-xs"
                            placeholder="Reason"
                            value={r.overrideReason}
                            onChange={(e) => set(r.it.id, { overrideReason: e.target.value })}
                          />
                        </div>
                      ) : (
                        <div>
                          <span className="text-sm text-gray-700">₦{(Number(r.unitPrice) || 0).toLocaleString()}</span>
                          {canOverridePrice && (
                            <button
                              type="button"
                              className="block text-[11px] text-primary hover:underline"
                              onClick={() => set(r.it.id, { overriding: true, unitPrice: String(r.unitPrice) })}
                            >
                              Override
                            </button>
                          )}
                        </div>
                      )}
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
          Formulary items draw stock earliest-expiry first. Off-formulary items are not in the pharmacy
          catalogue and do not affect stock levels. Items left at quantity 0 stay pending. Charges post to
          the visit invoice (or a new pharmacy invoice if there is no visit).
          {gateOn && !emergency && (
            <span className="block mt-1">
              This hospital requires payment before dispensing - an HMO-covered or admitted-patient charge still
              releases immediately; a cash or co-pay charge is prepared and charged now, then held back from stock
              until the invoice is paid in full.
            </span>
          )}
        </p>
        {gateOn && canEmergencyOverride && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <label className="flex items-start gap-2 text-sm text-amber-800">
              <input type="checkbox" className="mt-0.5" checked={emergency} onChange={(e) => setEmergency(e.target.checked)} />
              <span>
                Emergency override - dispense immediately, skipping the payment gate
                <span className="block text-xs text-amber-700">Audited. Use only when stopping to collect payment first is not acceptable.</span>
              </span>
            </label>
            {emergency && (
              <Field label="Reason" required>
                <Textarea rows={2} value={emergencyReason} onChange={(e) => setEmergencyReason(e.target.value)} placeholder="Why this cannot wait for payment" />
              </Field>
            )}
          </div>
        )}
        <Field label="Note">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Counselling / substitution notes" />
        </Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {rows.some(needsReason) && (
          <p className="text-xs text-amber-600">
            Enter a reason for each price override or off-formulary item before confirming.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={m.isPending}
            disabled={
              !rows.some((r) => Number(r.quantity) > 0) ||
              rows.some(needsReason) ||
              (emergency && emergencyReason.trim().length < 2)
            }
            onClick={() => m.mutate()}
          >
            {emergency ? 'Confirm emergency dispense' : title === 'Prepare' ? 'Confirm prepare' : 'Confirm dispense'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
