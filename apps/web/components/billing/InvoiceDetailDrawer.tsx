'use client'
import { Fragment, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { InvoiceDetailDTO } from '@oudhealth/contracts'
import { Button, Drawer, Field, Input, Textarea } from '@/components/ui/kit'
import { useToast } from '@/components/ui/feedback'
import { can } from '@/lib/permissions'
import { billingApi, naira, INVOICE_STATUS_META, PAYER_TYPES } from '@/lib/billing'
import { claimsApi, CLAIM_STATUS_META } from '@/lib/claims'
import { RecordPaymentModal } from './RecordPaymentModal'
import { ReceiptView } from './ReceiptView'
import { AddItemModal, type BuilderLine } from './AddItemModal'

const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB') : '-')
const payerLabel = (v: string) => PAYER_TYPES.find((p) => p.value === v)?.label ?? v

export function InvoiceDetailDrawer({
  invoiceId,
  open,
  onClose,
}: {
  invoiceId: string | null
  open: boolean
  onClose: () => void
}) {
  const { data: session } = useSession()
  const toast = useToast()
  const canManage = can(session?.role, 'billing:manage')
  const canPay = can(session?.role, 'invoice:pay')
  const canClaims = can(session?.role, 'claims:manage')
  const router = useRouter()
  const qc = useQueryClient()
  const [pay, setPay] = useState(false)
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [reversingId, setReversingId] = useState<string | null>(null)
  const [reverseReason, setReverseReason] = useState('')
  const [err, setErr] = useState('')
  const [addingLine, setAddingLine] = useState(false)
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editDiscount, setEditDiscount] = useState('')
  const [editReason, setEditReason] = useState('')
  const [removingLineId, setRemovingLineId] = useState<string | null>(null)
  const [removeReason, setRemoveReason] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const q = useQuery({
    queryKey: ['billing-invoice', invoiceId],
    queryFn: () => billingApi.getInvoice(invoiceId!),
    enabled: open && !!invoiceId,
  })
  const inv = q.data

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['billing-invoice', invoiceId] })
    qc.invalidateQueries({ queryKey: ['billing-invoices'] })
  }

  const reverse = useMutation({
    mutationFn: (p: { id: string; reason: string }) => billingApi.reversePayment(p.id, p.reason),
    onSuccess: () => { setReversingId(null); setReverseReason(''); toast('Payment reversed', 'success'); invalidate() },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not reverse.'),
  })
  const cancel = useMutation({
    mutationFn: () => billingApi.cancelInvoice(invoiceId!, cancelReason.trim()),
    onSuccess: () => { setCancelling(false); setCancelReason(''); toast('Invoice cancelled', 'success'); invalidate() },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not cancel.'),
  })
  const raiseClaim = useMutation({
    mutationFn: (invId: string) => claimsApi.generate([invId]),
    onSuccess: (res) => {
      if (res.created.length) { toast('Claim raised', 'success'); router.push('/claims') }
      else setErr(res.skipped[0]?.reason ?? 'Could not raise a claim for this invoice.')
    },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not raise a claim.'),
  })
  const acknowledgeReopen = useMutation({
    mutationFn: () => billingApi.acknowledgeReopen(invoiceId!),
    onSuccess: () => { toast('Reopen notice acknowledged', 'success'); invalidate() },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not acknowledge.', 'error'),
  })
  const addLine = useMutation({
    mutationFn: (line: BuilderLine) =>
      billingApi.addInvoiceLine(invoiceId!, {
        description: line.description, quantity: line.quantity, unitPrice: line.unitPrice,
        discountPct: line.discountPct || undefined, category: line.category,
        serviceItemId: line.serviceItemId, drugId: line.drugId, reason: line.reason,
      }),
    onSuccess: () => { toast('Line added', 'success'); invalidate() },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not add the line.', 'error'),
  })
  const updateLine = useMutation({
    mutationFn: (p: { lineId: string; quantity: number; unitPrice: number; discountPct: number; reason: string }) =>
      billingApi.updateInvoiceLine(invoiceId!, p.lineId, {
        quantity: p.quantity, unitPrice: p.unitPrice, discountPct: p.discountPct, reason: p.reason || undefined,
      }),
    onSuccess: () => { setEditingLineId(null); setEditReason(''); toast('Line updated', 'success'); invalidate() },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not update the line.', 'error'),
  })
  const removeLine = useMutation({
    mutationFn: (p: { lineId: string; reason: string }) => billingApi.removeInvoiceLine(invoiceId!, p.lineId, p.reason),
    onSuccess: () => { setRemovingLineId(null); setRemoveReason(''); toast('Line removed', 'success'); invalidate() },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not remove the line.', 'error'),
  })
  const history = useQuery({
    queryKey: ['billing-invoice-history', invoiceId],
    queryFn: () => billingApi.lineHistory(invoiceId!),
    enabled: showHistory && !!invoiceId,
  })

  const meta = inv ? INVOICE_STATUS_META[inv.status] : null
  const locked = !!inv && (inv.payments.some((p) => !p.reversedAt) || !!inv.claim)
  const canEditLines = canManage && !!inv && inv.status !== 'CANCELLED' && !locked
  const startEdit = (l: NonNullable<typeof inv>['lines'][number]) => {
    setEditingLineId(l.id)
    setEditQty(String(l.quantity))
    setEditPrice(String(Number(l.unitPrice)))
    setEditDiscount(l.discountPct ? String(Number(l.discountPct)) : '')
    setEditReason('')
  }

  return (
    <>
      <Drawer open={open} onClose={onClose} title={inv ? `Invoice ${inv.invoiceNumber}` : 'Invoice'} width={720}>
        {!inv ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <div className="space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-bold text-gray-900">{inv.patient?.name}</p>
                <p className="text-xs text-gray-400">
                  {inv.patient?.patientNumber} · {inv.patient?.phone ?? 'no phone'} · created {dt(inv.createdAt)}
                  {inv.createdByName ? ` by ${inv.createdByName}` : ''}
                </p>
              </div>
              {meta && (
                <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: meta.color, backgroundColor: meta.bg }}>
                  {meta.label}
                </span>
              )}
            </div>

            {inv.isSupplementary && (
              <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-sm text-amber-700">
                Supplementary invoice{inv.supplementOfInvoiceNumber ? ` - linked to ${inv.supplementOfInvoiceNumber}` : ''}
              </div>
            )}

            {inv.reopenFlaggedAt && !inv.reopenAcknowledgedAt && (
              <div className="flex items-center justify-between rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-700">
                <span>This visit was reopened on {dt(inv.reopenFlaggedAt)} while this invoice was already paid or claimed.</span>
                {canManage && (
                  <button
                    className="text-red-700 font-medium hover:underline disabled:opacity-50 flex-shrink-0 ml-3"
                    disabled={acknowledgeReopen.isPending}
                    onClick={() => acknowledgeReopen.mutate()}
                  >
                    Acknowledge
                  </button>
                )}
              </div>
            )}

            {inv.status === 'CANCELLED' && (
              <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-600">
                Cancelled {dt(inv.cancelledAt)} · {inv.voidReason}
              </div>
            )}

            {inv.payerType === 'HMO' && (
              <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm">
                <span className="text-gray-600">
                  HMO claim:{' '}
                  {inv.claim ? (
                    <span className="font-medium" style={{ color: CLAIM_STATUS_META[inv.claim.status as keyof typeof CLAIM_STATUS_META]?.color }}>
                      {inv.claim.claimNumber} · {CLAIM_STATUS_META[inv.claim.status as keyof typeof CLAIM_STATUS_META]?.label ?? inv.claim.status}
                    </span>
                  ) : (
                    <span className="text-gray-400">not raised</span>
                  )}
                </span>
                {inv.claim ? (
                  <button className="text-primary hover:underline" onClick={() => router.push('/claims')}>Open Claims</button>
                ) : (
                  canClaims && inv.visitId && inv.status !== 'CANCELLED' && (
                    <button
                      className="text-primary hover:underline disabled:opacity-50"
                      disabled={raiseClaim.isPending}
                      onClick={() => raiseClaim.mutate(inv.id)}
                    >
                      Raise claim
                    </button>
                  )
                )}
              </div>
            )}

            <div className="flex items-center justify-between -mb-2">
              {!canEditLines && canManage && inv.status !== 'CANCELLED' ? (
                <p className="text-xs text-gray-400">
                  {inv.claim
                    ? 'This invoice has an insurance claim - line items cannot be edited.'
                    : locked
                      ? 'Reverse the payment(s) on this invoice to edit its line items.'
                      : null}
                </p>
              ) : <span />}
              {canManage && (
                <button className="text-xs text-gray-400 hover:text-primary hover:underline" onClick={() => setShowHistory(true)}>
                  Edit history
                </button>
              )}
            </div>

            <div className="border border-gray-100 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>{['Item', 'Category', 'Provided by', 'Unit ₦', 'Qty', 'Disc %', 'Amount', ...(canEditLines ? [''] : [])].map((h, i) => (
                    <th key={i} className="text-left font-medium px-3 py-2">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {inv.lines.map((l) => (
                    editingLineId === l.id ? (
                      <Fragment key={l.id}>
                        <tr className="border-t border-gray-100 bg-blue-50/30">
                          <td className="px-3 py-2" colSpan={3}>{l.description}</td>
                          <td className="px-2 py-1.5"><Input type="number" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} className="w-24" /></td>
                          <td className="px-2 py-1.5"><Input type="number" value={editQty} onChange={(e) => setEditQty(e.target.value)} className="w-16" /></td>
                          <td className="px-2 py-1.5"><Input type="number" value={editDiscount} onChange={(e) => setEditDiscount(e.target.value)} className="w-16" /></td>
                          <td className="px-3 py-2 text-gray-500">
                            {naira((Number(editPrice) || 0) * (Number(editQty) || 0) * (1 - (Number(editDiscount) || 0) / 100))}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <button
                              className="text-xs text-primary font-medium hover:underline disabled:opacity-50"
                              disabled={updateLine.isPending || !Number(editQty) || Number(editPrice) < 0}
                              onClick={() => updateLine.mutate({
                                lineId: l.id,
                                quantity: Number(editQty),
                                unitPrice: Number(editPrice),
                                discountPct: Number(editDiscount) || 0,
                                reason: editReason.trim(),
                              })}
                            >
                              Save
                            </button>
                            <button className="text-xs text-gray-400 hover:underline ml-2" onClick={() => setEditingLineId(null)}>
                              Cancel
                            </button>
                          </td>
                        </tr>
                        <tr className="bg-blue-50/30">
                          <td className="px-3 pb-2" colSpan={8}>
                            <input
                              value={editReason}
                              onChange={(e) => setEditReason(e.target.value)}
                              placeholder="Reason (required if the price overrides the catalogue price or the discount increases)"
                              className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs"
                            />
                          </td>
                        </tr>
                      </Fragment>
                    ) : (
                      <tr key={l.id} className="border-t border-gray-100">
                        <td className="px-3 py-2">
                          {l.description}
                          {l.edited && (
                            <button
                              className="ml-1.5 text-[11px] text-amber-600 hover:underline align-middle"
                              onClick={() => setShowHistory(true)}
                              title="This line has been edited - see Edit history"
                            >
                              (edited)
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-500">{l.category ?? '-'}</td>
                        <td className="px-3 py-2 text-gray-500">{l.providedByName ?? '-'}</td>
                        <td className="px-3 py-2">{naira(l.unitPrice)}</td>
                        <td className="px-3 py-2">{l.quantity}</td>
                        <td className="px-3 py-2">{l.discountPct ? `${Number(l.discountPct)}%` : '-'}</td>
                        <td className="px-3 py-2">{naira(l.lineTotal)}</td>
                        {canEditLines && (
                          <td className="px-3 py-2 whitespace-nowrap">
                            <button className="text-xs text-primary hover:underline" onClick={() => startEdit(l)}>Edit</button>
                            {inv.lines.length > 1 && (
                              <button
                                className="text-xs text-gray-400 hover:text-red-500 ml-2"
                                onClick={() => { setRemovingLineId(l.id); setRemoveReason('') }}
                              >
                                Remove
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  ))}
                  {inv.lines.map((l) => removingLineId === l.id && (
                    <tr key={`${l.id}-remove`} className="bg-red-50/40">
                      <td className="px-3 py-2" colSpan={canEditLines ? 8 : 7}>
                        <div className="flex items-center gap-2">
                          <input
                            value={removeReason}
                            onChange={(e) => setRemoveReason(e.target.value)}
                            placeholder={`Reason for removing "${l.description}" (required)`}
                            className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs"
                          />
                          <button
                            className="text-xs text-red-600 font-medium hover:underline disabled:opacity-50 flex-shrink-0"
                            disabled={removeLine.isPending || removeReason.trim().length < 3}
                            onClick={() => removeLine.mutate({ lineId: l.id, reason: removeReason.trim() })}
                          >
                            Confirm remove
                          </button>
                          <button className="text-xs text-gray-400 hover:underline flex-shrink-0" onClick={() => setRemovingLineId(null)}>
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {canEditLines && (
                    <tr className="border-t border-gray-100">
                      <td className="px-3 py-2" colSpan={8}>
                        <button className="text-sm text-primary font-medium hover:underline" onClick={() => setAddingLine(true)}>
                          + Add line
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="text-sm">
                  <tr className="border-t border-gray-200">
                    <td className="px-3 py-1.5 text-gray-500" colSpan={6}>Subtotal</td>
                    <td className="px-3 py-1.5">{naira(inv.subtotal)}</td>
                    {canEditLines && <td />}
                  </tr>
                  {inv.discountPct && (
                    <tr>
                      <td className="px-3 py-1.5 text-gray-500" colSpan={6}>
                        Invoice discount {Number(inv.discountPct)}%{inv.discountReason ? ` · ${inv.discountReason}` : ''}
                      </td>
                      <td className="px-3 py-1.5 text-red-600">
                        -{naira(Number(inv.subtotal) - Number(inv.totalAmount))}
                      </td>
                      {canEditLines && <td />}
                    </tr>
                  )}
                  <tr className="font-bold border-t border-gray-200">
                    <td className="px-3 py-2" colSpan={6}>Total payable</td>
                    <td className="px-3 py-2">{naira(inv.totalAmount)}</td>
                    {canEditLines && <td />}
                  </tr>
                  <tr className="text-gray-500">
                    <td className="px-3 py-1.5" colSpan={6}>Paid</td>
                    <td className="px-3 py-1.5">{naira(inv.paidAmount)}</td>
                    {canEditLines && <td />}
                  </tr>
                  <tr className="font-semibold">
                    <td className="px-3 py-1.5" colSpan={6}>Balance due</td>
                    <td className="px-3 py-1.5">{naira(inv.balanceDue)}</td>
                    {canEditLines && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Payments</p>
              {inv.payments.length === 0 ? (
                <p className="text-sm text-gray-400">No payments yet.</p>
              ) : (
                <ul className="border border-gray-100 rounded-xl divide-y text-sm">
                  {inv.payments.map((p) => (
                    <li key={p.id} className={p.reversedAt ? 'opacity-50' : ''}>
                      <div className="px-3 py-2 flex items-center justify-between">
                        <div>
                          <span className="font-medium">{naira(p.amount)}</span>
                          <span className="text-gray-400"> · {p.method} · {payerLabel(p.payerType)}{p.payerName ? ` (${p.payerName})` : ''}</span>
                          {p.reference && <span className="text-gray-400"> · {p.reference}</span>}
                          <span className="block text-xs text-gray-400">
                            {p.receiptNumber} · {dt(p.paidAt)}{p.receivedByName ? ` · ${p.receivedByName}` : ''}
                            {p.reversedAt && ` · reversed: ${p.reversalReason}`}
                          </span>
                        </div>
                        {!p.reversedAt && (
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button className="text-xs text-primary hover:underline" onClick={() => setReceiptId(p.id)}>Receipt</button>
                            {canManage && (
                              <button
                                className="text-xs text-gray-400 hover:text-red-500"
                                onClick={() => { setReversingId(p.id); setReverseReason('') }}
                              >
                                Reverse
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {reversingId === p.id && (
                        <div className="mx-3 mb-3 rounded-xl border border-gray-100 p-3">
                          <Field label="Reason for reversing this payment">
                            <Textarea rows={2} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
                          </Field>
                          <div className="flex justify-end gap-2 mt-2">
                            <Button variant="secondary" onClick={() => { setReversingId(null); setReverseReason('') }}>
                              Cancel
                            </Button>
                            <Button
                              variant="danger"
                              loading={reverse.isPending}
                              disabled={reverseReason.trim().length < 3}
                              onClick={() => reverse.mutate({ id: p.id, reason: reverseReason.trim() })}
                            >
                              Confirm reverse
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {err && <p className="text-sm text-red-600">{err}</p>}

            {inv.status !== 'CANCELLED' && (
              <div className="flex items-center gap-3">
                {canManage && (
                  <Button variant="danger" onClick={() => setCancelling((v) => !v)}>Cancel invoice</Button>
                )}
                {canPay && Number(inv.balanceDue) > 0 && (
                  <Button onClick={() => setPay(true)}>Record payment</Button>
                )}
              </div>
            )}

            {cancelling && (
              <div className="rounded-xl border border-gray-100 p-4">
                <Field label="Reason for cancelling">
                  <Textarea rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                </Field>
                <div className="flex justify-end mt-2">
                  <Button variant="danger" loading={cancel.isPending} disabled={cancelReason.trim().length < 3} onClick={() => cancel.mutate()}>
                    Confirm cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <RecordPaymentModal
        open={pay}
        onClose={() => { setPay(false); invalidate() }}
        invoice={
          inv
            ? { id: inv.id, invoiceNumber: inv.invoiceNumber, patientName: inv.patient?.name ?? '', balanceDue: inv.balanceDue }
            : null
        }
      />
      <ReceiptView paymentId={receiptId} open={!!receiptId} onClose={() => setReceiptId(null)} />
      <AddItemModal open={addingLine} onClose={() => setAddingLine(false)} onAdd={(line) => addLine.mutate(line)} showReason />

      <Drawer open={showHistory} onClose={() => setShowHistory(false)} title="Invoice edit history" width={520}>
        {!history.data ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : history.data.length === 0 ? (
          <p className="text-sm text-gray-400">No manual edits on this invoice yet.</p>
        ) : (
          <ul className="space-y-3">
            {history.data.map((h) => (
              <li key={h.id} className="border border-gray-100 rounded-xl p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-800">
                    {h.action === 'ADD_LINE' ? 'Line added' : h.action === 'VOID_LINE' ? 'Line removed' : 'Line edited'}
                  </span>
                  <span className="text-xs text-gray-400">{dt(h.createdAt)}</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{h.userName ?? 'Unknown user'}</p>
                {h.reason && <p className="text-xs text-gray-600 mt-1">Reason: {h.reason}</p>}
                {h.before && (
                  <p className="text-xs text-gray-400 mt-1">
                    Before: {JSON.stringify(h.before)}
                  </p>
                )}
                {h.after && (
                  <p className="text-xs text-gray-400">
                    After: {JSON.stringify(h.after)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Drawer>
    </>
  )
}
