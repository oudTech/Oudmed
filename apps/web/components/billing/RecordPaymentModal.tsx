'use client'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Field, Input, Modal, Select } from '@/components/ui/kit'
import { billingApi, naira, newIdempotencyKey, PAYER_TYPES } from '@/lib/billing'
import { ProviderCombobox } from '@/components/admin/ProviderCombobox'
import { ReceiptView } from './ReceiptView'

const PAYER_KIND: Record<string, string | undefined> = {
  HMO: 'HMO',
  RETAINER: 'COMPANY',
  NHIS: 'NHIS',
}

const METHODS: { value: string; label: string; icon: string }[] = [
  { value: 'TRANSFER', label: 'Transfer', icon: '⇄' },
  { value: 'CASH', label: 'Cash', icon: '₦' },
  { value: 'CARD', label: 'Card', icon: '▭' },
]

export function RecordPaymentModal({
  invoice,
  open,
  onClose,
}: {
  invoice: { id: string; invoiceNumber: string; patientName: string; balanceDue: string } | null
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [payerType, setPayerType] = useState('CASH')
  const [payerName, setPayerName] = useState('')
  const [method, setMethod] = useState('TRANSFER')
  const [reference, setReference] = useState('')
  const [err, setErr] = useState('')
  const [receiptId, setReceiptId] = useState<string | null>(null)
  // One key per payment attempt: a retried submit (double-click / network retry)
  // reuses it so the API does not record a second payment. Regenerated on reset.
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey())

  const balance = invoice ? Number(invoice.balanceDue) : 0
  const after = Math.max(0, balance - (Number(amount) || 0))

  const m = useMutation({
    mutationFn: () =>
      billingApi.recordPayment(invoice!.id, {
        amount: Number(amount),
        method,
        payerType,
        payerName: payerType !== 'CASH' ? payerName.trim() || undefined : undefined,
        reference: method !== 'CASH' ? reference.trim() || undefined : undefined,
        idempotencyKey: idemKey,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['billing-invoices'] })
      qc.invalidateQueries({ queryKey: ['billing-invoice', invoice!.id] })
      qc.invalidateQueries({ queryKey: ['pt-invoices'] })
      qc.invalidateQueries({ queryKey: ['patient'] })
      setReceiptId(res.paymentId)
    },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not record the payment.'),
  })

  const reset = () => {
    setAmount(''); setPayerType('CASH'); setPayerName(''); setMethod('TRANSFER'); setReference(''); setErr(''); setReceiptId(null)
    setIdemKey(newIdempotencyKey())
  }
  const close = () => { reset(); onClose() }

  if (!invoice) return null

  return (
    <>
      <Modal open={open && !receiptId} onClose={close} title="Record Payment" width={520} align="center">
        <div className="space-y-4">
          <div className="rounded-xl bg-gray-50 px-4 py-3 flex items-start justify-between">
            <div>
              <p className="font-medium text-gray-900">Invoice {invoice.invoiceNumber}</p>
              <p className="text-sm text-gray-500">{invoice.patientName}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">Balance due</p>
              <p className="text-xl font-bold text-gray-900">{naira(balance)}</p>
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Payment details</p>
            <Field label="Payment amount" required>
              <div className="flex gap-2">
                <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
                <Button variant="secondary" onClick={() => setAmount(String(balance))}>Pay full amount</Button>
              </div>
            </Field>
            <p className="text-xs text-gray-500">Balance due after payment <span className="font-semibold text-gray-800">{naira(after)}</span></p>

            <Field label="Payer">
              <Select value={payerType} onChange={(e) => setPayerType(e.target.value)}>
                {PAYER_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </Select>
            </Field>
            {payerType !== 'CASH' && (
              <Field label="Payer name">
                <ProviderCombobox
                  kind={PAYER_KIND[payerType]}
                  value={payerName}
                  onChange={setPayerName}
                  placeholder="HMO / company name"
                />
              </Field>
            )}

            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pt-1">Payment method</p>
            <div className="grid grid-cols-3 gap-3">
              {METHODS.map((mm) => (
                <button
                  key={mm.value}
                  onClick={() => setMethod(mm.value)}
                  className={`rounded-xl border py-4 text-sm font-medium flex flex-col items-center gap-1 ${method === mm.value ? 'border-primary bg-blue-50 text-primary' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  <span className="text-lg">{mm.icon}</span>
                  {mm.label}
                </button>
              ))}
            </div>
            {method !== 'CASH' && (
              <Field label="Reference">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction / card reference" />
              </Field>
            )}
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button
              loading={m.isPending}
              disabled={!amount || Number(amount) <= 0 || Number(amount) > balance}
              onClick={() => { setErr(''); m.mutate() }}
            >
              Record Payment
            </Button>
          </div>
        </div>
      </Modal>

      <ReceiptView paymentId={receiptId} open={!!receiptId} onClose={close} />
    </>
  )
}
