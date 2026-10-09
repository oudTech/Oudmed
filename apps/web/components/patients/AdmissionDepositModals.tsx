'use client'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, Field, Input, Select, Textarea, Modal } from '@/components/ui/kit'
import { useToast } from '@/components/ui/feedback'
import { addAdmissionDeposit, refundAdmissionDeposit, applyAdmissionDeposit } from '@/lib/hospital'

/** Deposit-taking, refund, and apply-to-bill modals for one admission - shared
 * between the inpatient workspace (`/admissions/[id]`) and the billing-only
 * "Inpatient billing" list (`/billing/admissions`), which cannot reach the
 * workspace itself (gated on `patient:read`, which billing roles lack). */
export function AddDepositModal({ admissionId, open, onClose, onDone }: { admissionId: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('CASH')
  const [reference, setReference] = useState('')

  const m = useMutation({
    mutationFn: () => addAdmissionDeposit(admissionId, { amount: Number(amount), method, reference: reference || undefined }),
    onSuccess: (res) => {
      toast(`Deposit recorded - receipt ${res.receiptNumber}`, 'success')
      setAmount(''); setReference(''); onClose(); onDone()
    },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not record the deposit.', 'error'),
  })

  return (
    <Modal open={open} onClose={onClose} title="Record a deposit" width={400} align="center">
      <div className="space-y-3">
        <Field label="Amount (₦)" required>
          <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="TRANSFER">Transfer</option>
          </Select>
        </Field>
        <Field label="Reference (optional)">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={!Number(amount)} onClick={() => m.mutate()}>Record deposit</Button>
        </div>
      </div>
    </Modal>
  )
}

export function RefundDepositModal({ admissionId, deposit, onClose, onDone }: { admissionId: string; deposit: { id: string; max: number } | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')

  const key = deposit?.id ?? ''
  const [seen, setSeen] = useState(key)
  if (key !== seen) {
    setSeen(key)
    setAmount(deposit ? String(deposit.max) : '')
    setReason('')
  }

  const m = useMutation({
    mutationFn: () => refundAdmissionDeposit(admissionId, deposit!.id, { amount: Number(amount), reason: reason.trim() }),
    onSuccess: () => { toast('Refund recorded', 'success'); onClose(); onDone() },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not record the refund.', 'error'),
  })

  if (!deposit) return null
  return (
    <Modal open={!!deposit} onClose={onClose} title="Refund deposit" width={400} align="center">
      <div className="space-y-3">
        <Field label={`Amount (₦, up to ${deposit.max})`} required>
          <Input type="number" min={0} max={deposit.max} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reason" required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            loading={m.isPending}
            disabled={!Number(amount) || Number(amount) > deposit.max || reason.trim().length < 3}
            onClick={() => m.mutate()}
          >
            Confirm refund
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function ApplyDepositModal({ admissionId, max, open, onClose, onDone }: { admissionId: string; max: number; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')

  const key = `${open}-${max}`
  const [seen, setSeen] = useState(key)
  if (key !== seen) { setSeen(key); setAmount(max > 0 ? String(max) : '') }

  const m = useMutation({
    mutationFn: () => applyAdmissionDeposit(admissionId, Number(amount)),
    onSuccess: () => { toast('Deposit applied to the bill', 'success'); onClose(); onDone() },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not apply the deposit.', 'error'),
  })

  return (
    <Modal open={open} onClose={onClose} title="Apply deposit to the bill" width={400} align="center">
      <div className="space-y-3">
        <Field label={`Amount (₦, up to ${max})`} required>
          <Input type="number" min={0} max={max} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <p className="text-xs text-gray-400">Converts deposit credit into a real payment against the amount owed - this is recognised as revenue now, not when the deposit was first taken.</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={!Number(amount) || Number(amount) > max} onClick={() => m.mutate()}>Apply</Button>
        </div>
      </div>
    </Modal>
  )
}
