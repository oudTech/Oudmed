'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ClaimBatchDTO, ClaimDetailDTO } from '@oudhealth/contracts'
import { Button, Drawer, Field, Input, Select, Textarea } from '@/components/ui/kit'
import { claimsApi, CLAIM_STATUS_META, naira } from '@/lib/claims'

const money = (v: string) => {
  const n = Number(v)
  return n < 0 ? `(${naira(Math.abs(n))})` : naira(n)
}
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB') : '-')

export function ClaimDetailDrawer({
  claimId,
  open,
  onClose,
}: {
  claimId: string | null
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [err, setErr] = useState('')
  const [confirm, setConfirm] = useState<'writeoff' | 'cancel' | null>(null)
  const [reason, setReason] = useState('')
  const [batchId, setBatchId] = useState('')

  const q = useQuery({
    queryKey: ['claim', claimId],
    queryFn: () => claimsApi.get(claimId!),
    enabled: open && !!claimId,
  })
  const claim = q.data

  const openBatches = useQuery({
    queryKey: ['claim-open-batches', claim?.providerId],
    queryFn: () => claimsApi.batches.list({ providerId: claim!.providerId, status: 'OPEN' }),
    enabled: open && !!claim && claim.status === 'DRAFT',
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['claims'] })
    qc.invalidateQueries({ queryKey: ['claim', claimId] })
    qc.invalidateQueries({ queryKey: ['claim-receivables'] })
    qc.invalidateQueries({ queryKey: ['claim-batches'] })
  }

  const submit = useMutation({
    mutationFn: () => claimsApi.submit(claimId!, batchId || undefined),
    onSuccess: invalidate,
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not submit the claim.'),
  })
  const writeOff = useMutation({
    mutationFn: () => claimsApi.writeOff(claimId!, reason.trim()),
    onSuccess: () => { invalidate(); setConfirm(null); setReason('') },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not write off the claim.'),
  })
  const cancel = useMutation({
    mutationFn: () => claimsApi.cancel(claimId!, reason.trim()),
    onSuccess: () => { invalidate(); setConfirm(null); setReason(''); onClose() },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not cancel the claim.'),
  })

  const meta = claim ? CLAIM_STATUS_META[claim.status] : null

  return (
    <Drawer open={open} onClose={onClose} title={claim ? `Claim ${claim.claimNumber}` : 'Claim'} width={760}>
      {!claim ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium rounded-full px-2.5 py-1" style={{ color: meta!.color, backgroundColor: meta!.bg }}>
              {meta!.label}
            </span>
            <span className="text-sm text-gray-500">{claim.providerName}</span>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Info label="Patient" value={claim.patient?.name ?? claim.memberName} />
            <Info label="Member number" value={claim.memberNumber || '-'} />
            <Info label="Authorisation" value={claim.authCode || '-'} />
            <Info label="Service date" value={dt(claim.serviceDate)} />
            <Info label="Diagnosis" value={claim.diagnosisCode || claim.diagnosisSummary || '-'} />
            <Info label="Invoice" value={claim.invoiceNumber ?? '-'} />
            {claim.batchNumber && <Info label="Batch" value={claim.batchNumber} />}
            {claim.submittedAt && <Info label="Submitted" value={dt(claim.submittedAt)} />}
          </div>

          <div className="border border-gray-100 rounded-xl overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  {['Service', 'Code', 'Qty', 'Unit price', 'Claimed', 'Approved', 'Covered'].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {claim.lines.map((l) => (
                  <tr key={l.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-800">{l.description}</td>
                    <td className="px-3 py-2 text-gray-500">{l.serviceCode || '-'}</td>
                    <td className="px-3 py-2 text-gray-500">{l.quantity}</td>
                    <td className="px-3 py-2 text-gray-500">{money(l.unitPrice)}</td>
                    <td className="px-3 py-2">{money(l.claimedAmount)}</td>
                    <td className="px-3 py-2 text-gray-500">{l.approvedAmount != null ? money(l.approvedAmount) : '-'}</td>
                    <td className="px-3 py-2 text-gray-400">{l.covered ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Total label="Claimed" value={claim.claimedAmount} strong />
            <Total label="Approved" value={claim.approvedAmount ?? '-'} />
            <Total label="Paid" value={claim.paidAmount} />
            <Total label="Patient responsibility" value={claim.patientResponsibility} />
            <Total label="Written off" value={claim.writeOffAmount} />
            <Total label="Outstanding" value={claim.outstanding} strong />
          </div>

          {claim.rejectionReason && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              Rejected: {claim.rejectionReason}
            </p>
          )}

          {claim.history.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Remittance history</p>
              <div className="space-y-1.5">
                {claim.history.map((h) => (
                  <div key={h.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                    <span className="text-gray-600">
                      {h.remittanceNumber} · {dt(h.receivedAt)}
                      {h.reversed && <span className="ml-1.5 text-red-500">(reversed)</span>}
                    </span>
                    <span className="text-gray-800">
                      approved {money(h.approvedAmount)} · paid {money(h.paidAmount)}
                      {Number(h.shortfall) > 0 && ` · shortfall ${money(h.shortfall)}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {err && <p className="text-sm text-red-600">{err}</p>}

          {/* actions */}
          {claim.status === 'DRAFT' && !confirm && (
            <div className="space-y-3 border-t border-gray-100 pt-4">
              {(openBatches.data?.rows.length ?? 0) > 0 && (
                <Field label="Add to an open batch (optional)">
                  <Select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                    <option value="">Submit without a batch</option>
                    {openBatches.data!.rows.map((b: ClaimBatchDTO) => (
                      <option key={b.id} value={b.id}>{b.batchNumber} · {b.claimCount} claims</option>
                    ))}
                  </Select>
                </Field>
              )}
              <div className="flex gap-2">
                <Button loading={submit.isPending} onClick={() => { setErr(''); submit.mutate() }}>Submit claim</Button>
                <Button variant="secondary" onClick={() => setConfirm('cancel')}>Cancel claim</Button>
              </div>
            </div>
          )}
          {claim.status === 'SUBMITTED' && !confirm && (
            <div className="flex gap-2 border-t border-gray-100 pt-4">
              <Button variant="secondary" onClick={() => setConfirm('writeoff')}>Write off</Button>
              <Button variant="secondary" onClick={() => setConfirm('cancel')}>Cancel claim</Button>
            </div>
          )}
          {claim.status === 'PART_PAID' && !confirm && (
            <div className="flex gap-2 border-t border-gray-100 pt-4">
              <Button variant="secondary" onClick={() => setConfirm('writeoff')}>Write off the balance</Button>
            </div>
          )}

          {confirm && (
            <div className="space-y-2 border-t border-gray-100 pt-4">
              <Field label={confirm === 'writeoff' ? 'Reason for the write-off' : 'Reason for cancelling'}>
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  loading={writeOff.isPending || cancel.isPending}
                  disabled={reason.trim().length < 2}
                  onClick={() => { setErr(''); confirm === 'writeoff' ? writeOff.mutate() : cancel.mutate() }}
                >
                  {confirm === 'writeoff' ? 'Write off' : 'Cancel claim'}
                </Button>
                <Button variant="secondary" onClick={() => { setConfirm(null); setReason('') }}>Back</Button>
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

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const display = value === '-' ? '-' : (Number(value) < 0 ? `(${naira(Math.abs(Number(value)))})` : naira(value))
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <span className="block text-xs text-gray-400">{label}</span>
      <span className={strong ? 'font-bold text-gray-900' : 'text-gray-700'}>{display}</span>
    </div>
  )
}
