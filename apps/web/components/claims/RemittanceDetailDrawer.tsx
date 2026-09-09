'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Drawer, Field, Textarea } from '@/components/ui/kit'
import { claimsApi, naira } from '@/lib/claims'

const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB') : '-')

export function RemittanceDetailDrawer({
  remittanceId,
  open,
  onClose,
}: {
  remittanceId: string | null
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [reversing, setReversing] = useState(false)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')

  const q = useQuery({
    queryKey: ['claim-remittance', remittanceId],
    queryFn: () => claimsApi.remittances.get(remittanceId!),
    enabled: open && !!remittanceId,
  })
  const r = q.data

  const reverse = useMutation({
    mutationFn: () => claimsApi.remittances.reverse(remittanceId!, reason.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claim-remittances'] })
      qc.invalidateQueries({ queryKey: ['claim-remittance', remittanceId] })
      qc.invalidateQueries({ queryKey: ['claims'] })
      qc.invalidateQueries({ queryKey: ['claim-receivables'] })
      qc.invalidateQueries({ queryKey: ['billing-invoices'] })
      setReversing(false)
      setReason('')
    },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not reverse the remittance.'),
  })

  return (
    <Drawer open={open} onClose={onClose} title={r ? `Remittance ${r.remittanceNumber}` : 'Remittance'} width={720}>
      {!r ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-5">
          {r.reversedAt && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              Reversed on {dt(r.reversedAt)}{r.reversalReason ? ` · ${r.reversalReason}` : ''}
            </p>
          )}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Info label="Provider" value={r.providerName} />
            <Info label="Received" value={dt(r.receivedAt)} />
            <Info label="Amount received" value={naira(r.receivedAmount)} />
            <Info label="Allocated" value={naira(r.allocatedAmount)} />
            <Info label="Reference" value={r.reference ?? '-'} />
            <Info label="Recorded by" value={r.recordedByName ?? '-'} />
          </div>

          <div className="border border-gray-100 rounded-xl overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  {['Claim #', 'Patient', 'Approved', 'Paid', 'Shortfall', 'Handling'].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.allocations.map((a) => (
                  <tr key={a.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">{a.claimNumber}</td>
                    <td className="px-3 py-2 text-gray-800">{a.patientName}</td>
                    <td className="px-3 py-2">{naira(a.approvedAmount)}</td>
                    <td className="px-3 py-2">{naira(a.paidAmount)}</td>
                    <td className="px-3 py-2 text-gray-500">{Number(a.shortfall) > 0 ? naira(a.shortfall) : '-'}</td>
                    <td className="px-3 py-2 text-gray-500">{a.shortfallAction ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}

          {!r.reversedAt && !reversing && (
            <Button variant="secondary" onClick={() => setReversing(true)}>Reverse this remittance</Button>
          )}
          {reversing && (
            <div className="space-y-2 border-t border-gray-100 pt-4">
              <Field label="Reason for reversal">
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <p className="text-xs text-gray-500">
                Every payment this remittance posted to an invoice is reversed and the claims return to submitted.
              </p>
              <div className="flex gap-2">
                <Button variant="danger" loading={reverse.isPending} disabled={reason.trim().length < 2} onClick={() => { setErr(''); reverse.mutate() }}>
                  Reverse
                </Button>
                <Button variant="secondary" onClick={() => setReversing(false)}>Back</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs text-gray-400">{label}</span>
      <span className="text-gray-800">{value}</span>
    </div>
  )
}
