'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { AdmissionPendingRefundDTO } from '@oudhealth/contracts'
import { Button, Field, Input, Select, Modal } from '@/components/ui/kit'
import { useToast } from '@/components/ui/feedback'
import { can } from '@/lib/permissions'
import { naira } from '@/lib/billing'
import { listPendingRefunds, payAdmissionRefund } from '@/lib/hospital'
import { EmptyState } from '@/components/onboarding'

const dt = (iso: string) => new Date(iso).toLocaleString('en-GB')

/** F1c: deposit refunds due to patients, left pending because discharge
 * never blocks on a refund still being paid out. */
export default function RefundsDuePage() {
  const { data: session } = useSession()
  const allowed = can(session?.role, 'admission:deposit-refund')
  const qc = useQueryClient()
  const [paying, setPaying] = useState<AdmissionPendingRefundDTO | null>(null)

  const q = useQuery({ queryKey: ['pending-refunds'], queryFn: listPendingRefunds, enabled: allowed })
  const total = (q.data ?? []).reduce((s, r) => s + Number(r.amount), 0)

  if (!allowed) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Refunds due</h1>
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6">
          Only an Accountant or Hospital Admin can see and pay out refunds.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="px-8 pt-7 pb-4 flex-shrink-0">
        <Link href="/billing" className="text-sm text-gray-400 hover:text-gray-700">&larr; Invoices</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Refunds due</h1>
        <p className="text-sm text-gray-400 mt-1">
          Deposit credit owed back to patients - discharge never waits on these being paid out.
          {q.data && q.data.length > 0 && <span className="font-medium text-gray-600"> {naira(total)} total.</span>}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {!q.data ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : q.data.length === 0 ? (
          <EmptyState compact title="Nothing owed right now" description="Every deposit refund has been paid out." />
        ) : (
          <div className="border border-gray-100 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  {['Requested', 'Patient', 'Admission', 'Amount', ''].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.data.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="px-3 py-2.5 text-gray-500">{dt(r.requestedAt)}</td>
                    <td className="px-3 py-2.5">{r.patient.name} <span className="text-gray-400">({r.patient.patientNumber})</span></td>
                    <td className="px-3 py-2.5">
                      <Link href={`/admissions/${r.admissionId}`} className="text-primary hover:underline">{r.admissionNumber}</Link>
                    </td>
                    <td className="px-3 py-2.5 font-medium">{naira(r.amount)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Button variant="secondary" onClick={() => setPaying(r)}>Pay out</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PayRefundModal refund={paying} onClose={() => setPaying(null)} onDone={() => qc.invalidateQueries({ queryKey: ['pending-refunds'] })} />
    </div>
  )
}

function PayRefundModal({
  refund,
  onClose,
  onDone,
}: {
  refund: AdmissionPendingRefundDTO | null
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [method, setMethod] = useState('CASH')
  const [reference, setReference] = useState('')

  const key = refund?.id ?? ''
  const [seen, setSeen] = useState(key)
  if (key !== seen) { setSeen(key); setMethod('CASH'); setReference('') }

  const m = useMutation({
    mutationFn: () => payAdmissionRefund(refund!.admissionId, refund!.id, { method, reference: reference || undefined }),
    onSuccess: (res) => {
      toast(`Refund paid - receipt ${res.receiptNumber}`, 'success')
      onClose(); onDone()
    },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not pay out the refund.', 'error'),
  })

  if (!refund) return null
  return (
    <Modal open={!!refund} onClose={onClose} title="Pay out refund" width={400} align="center">
      <div className="space-y-3">
        <p className="text-sm text-gray-500">{naira(refund.amount)} owed to {refund.patient.name} ({refund.admissionNumber}).</p>
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
          <Button loading={m.isPending} onClick={() => m.mutate()}>Pay out</Button>
        </div>
      </div>
    </Modal>
  )
}
