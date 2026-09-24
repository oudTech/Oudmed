'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { InvoiceDetailDTO } from '@oudhealth/contracts'
import { Button, Drawer, Field, Textarea } from '@/components/ui/kit'
import { can } from '@/lib/permissions'
import { billingApi, naira, INVOICE_STATUS_META, PAYER_TYPES } from '@/lib/billing'
import { claimsApi, CLAIM_STATUS_META } from '@/lib/claims'
import { RecordPaymentModal } from './RecordPaymentModal'
import { ReceiptView } from './ReceiptView'

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
    onSuccess: () => { setReversingId(null); setReverseReason(''); invalidate() },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not reverse.'),
  })
  const cancel = useMutation({
    mutationFn: () => billingApi.cancelInvoice(invoiceId!, cancelReason.trim()),
    onSuccess: () => { setCancelling(false); setCancelReason(''); invalidate() },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not cancel.'),
  })
  const raiseClaim = useMutation({
    mutationFn: (visitId: string) => claimsApi.generate([visitId]),
    onSuccess: (res) => {
      if (res.created.length) router.push('/claims')
      else setErr(res.skipped[0]?.reason ?? 'Could not raise a claim for this invoice.')
    },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not raise a claim.'),
  })

  const meta = inv ? INVOICE_STATUS_META[inv.status] : null

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
                      onClick={() => raiseClaim.mutate(inv.visitId!)}
                    >
                      Raise claim
                    </button>
                  )
                )}
              </div>
            )}

            <div className="border border-gray-100 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>{['Item', 'Category', 'Provided by', 'Unit ₦', 'Qty', 'Disc %', 'Amount'].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {inv.lines.map((l) => (
                    <tr key={l.id} className="border-t border-gray-100">
                      <td className="px-3 py-2">{l.description}</td>
                      <td className="px-3 py-2 text-gray-500">{l.category ?? '-'}</td>
                      <td className="px-3 py-2 text-gray-500">{l.providedByName ?? '-'}</td>
                      <td className="px-3 py-2">{naira(l.unitPrice)}</td>
                      <td className="px-3 py-2">{l.quantity}</td>
                      <td className="px-3 py-2">{l.discountPct ? `${Number(l.discountPct)}%` : '-'}</td>
                      <td className="px-3 py-2">{naira(l.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="text-sm">
                  <tr className="border-t border-gray-200">
                    <td className="px-3 py-1.5 text-gray-500" colSpan={6}>Subtotal</td>
                    <td className="px-3 py-1.5">{naira(inv.subtotal)}</td>
                  </tr>
                  {inv.discountPct && (
                    <tr>
                      <td className="px-3 py-1.5 text-gray-500" colSpan={6}>
                        Invoice discount {Number(inv.discountPct)}%{inv.discountReason ? ` · ${inv.discountReason}` : ''}
                      </td>
                      <td className="px-3 py-1.5 text-red-600">
                        -{naira(Number(inv.subtotal) - Number(inv.totalAmount))}
                      </td>
                    </tr>
                  )}
                  <tr className="font-bold border-t border-gray-200">
                    <td className="px-3 py-2" colSpan={6}>Total payable</td>
                    <td className="px-3 py-2">{naira(inv.totalAmount)}</td>
                  </tr>
                  <tr className="text-gray-500">
                    <td className="px-3 py-1.5" colSpan={6}>Paid</td>
                    <td className="px-3 py-1.5">{naira(inv.paidAmount)}</td>
                  </tr>
                  <tr className="font-semibold">
                    <td className="px-3 py-1.5" colSpan={6}>Balance due</td>
                    <td className="px-3 py-1.5">{naira(inv.balanceDue)}</td>
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
    </>
  )
}
