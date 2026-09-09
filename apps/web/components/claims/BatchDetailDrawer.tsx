'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Drawer, Field, Input } from '@/components/ui/kit'
import { claimsApi, CLAIM_BATCH_STATUS_META, CLAIM_STATUS_META, naira } from '@/lib/claims'

const d = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB') : '-')

export function BatchDetailDrawer({
  batchId,
  open,
  onClose,
}: {
  batchId: string | null
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [submitting, setSubmitting] = useState(false)
  const [ref, setRef] = useState('')
  const [err, setErr] = useState('')
  const [downloading, setDownloading] = useState(false)

  const q = useQuery({
    queryKey: ['claim-batch', batchId],
    queryFn: () => claimsApi.batches.get(batchId!),
    enabled: open && !!batchId,
  })
  const batch = q.data

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['claim-batches'] })
    qc.invalidateQueries({ queryKey: ['claim-batch', batchId] })
    qc.invalidateQueries({ queryKey: ['claims'] })
  }

  const submit = useMutation({
    mutationFn: () => claimsApi.batches.submit(batchId!, ref.trim() || undefined),
    onSuccess: () => { invalidate(); setSubmitting(false); setRef('') },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not submit the batch.'),
  })
  const close = useMutation({
    mutationFn: () => claimsApi.batches.close(batchId!),
    onSuccess: invalidate,
  })
  const removeClaim = useMutation({
    mutationFn: (claimId: string) => claimsApi.batches.remove(batchId!, [claimId]),
    onSuccess: invalidate,
  })

  const download = async () => {
    setDownloading(true)
    try { await claimsApi.batches.downloadCsv(batchId!) } finally { setDownloading(false) }
  }

  const meta = batch ? CLAIM_BATCH_STATUS_META[batch.status] : null

  return (
    <Drawer open={open} onClose={onClose} title={batch ? `Batch ${batch.batchNumber}` : 'Batch'} width={760}>
      {!batch ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium rounded-full px-2.5 py-1" style={{ color: meta!.color, backgroundColor: meta!.bg }}>
              {meta!.label}
            </span>
            <span className="text-sm text-gray-500">{batch.providerName} · {d(batch.periodStart)} to {d(batch.periodEnd)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Total label="Claims" value={String(batch.claimCount)} />
            <Total label="Claimed" value={naira(batch.claimedTotal)} strong />
            <Total label="Approved" value={naira(batch.approvedTotal)} />
            <Total label="Paid" value={naira(batch.paidTotal)} />
          </div>
          {batch.submissionRef && <p className="text-sm text-gray-500">Submission reference: {batch.submissionRef}</p>}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={downloading} onClick={download}>Export schedule (CSV)</Button>
            {batch.status === 'OPEN' && !submitting && (
              <Button onClick={() => setSubmitting(true)}>Mark submitted</Button>
            )}
            {(batch.status === 'SUBMITTED' || batch.status === 'RECONCILED') && (
              <Button variant="secondary" loading={close.isPending} onClick={() => close.mutate()}>Close batch</Button>
            )}
          </div>

          {submitting && (
            <div className="space-y-2 rounded-lg border border-gray-100 p-3">
              <Field label="HMO submission reference (optional)">
                <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Portal / email acknowledgement" />
              </Field>
              {err && <p className="text-sm text-red-600">{err}</p>}
              <div className="flex gap-2">
                <Button loading={submit.isPending} onClick={() => { setErr(''); submit.mutate() }}>Confirm submitted</Button>
                <Button variant="secondary" onClick={() => setSubmitting(false)}>Back</Button>
              </div>
            </div>
          )}

          <div className="border border-gray-100 rounded-xl overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  {['Claim #', 'Patient', 'Service date', 'Claimed', 'Status', ''].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {batch.claims.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">No claims in this batch.</td></tr>
                ) : (
                  batch.claims.map((c) => {
                    const m = CLAIM_STATUS_META[c.status]
                    return (
                      <tr key={c.id} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-mono text-xs text-gray-600">{c.claimNumber}</td>
                        <td className="px-3 py-2 text-gray-800">{c.patientName}</td>
                        <td className="px-3 py-2 text-gray-500">{d(c.serviceDate)}</td>
                        <td className="px-3 py-2">{naira(c.claimedAmount)}</td>
                        <td className="px-3 py-2">
                          <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: m.color, backgroundColor: m.bg }}>{m.label}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {batch.status === 'OPEN' && (
                            <button className="text-xs text-red-500 hover:underline" onClick={() => removeClaim.mutate(c.id)}>Remove</button>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Drawer>
  )
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <span className="block text-xs text-gray-400">{label}</span>
      <span className={strong ? 'font-bold text-gray-900' : 'text-gray-700'}>{value}</span>
    </div>
  )
}
