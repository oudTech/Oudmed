'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ClaimBatchDTO } from '@oudhealth/contracts'
import { Button, Field, Input, Modal, Textarea } from '@/components/ui/kit'
import { claimsApi, CLAIM_BATCH_STATUS_META, naira } from '@/lib/claims'
import { Pagination } from '@/components/admin/AdminRowActions'
import { ProviderSelect } from './ProviderSelect'
import { BatchDetailDrawer } from './BatchDetailDrawer'

const todayISO = () => new Date().toISOString().slice(0, 10)
const monthAgoISO = () => {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 10)
}

export function BatchesTab() {
  const [page, setPage] = useState(1)
  const [neu, setNeu] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['claim-batches', page],
    queryFn: () => claimsApi.batches.list({ page }),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">Bundle submitted claims per provider for a period, then export the schedule.</p>
        <Button onClick={() => setNeu(true)}>New batch</Button>
      </div>

      <div className="border border-gray-100 rounded-xl overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              {['Batch #', 'Provider', 'Period', 'Claims', 'Claimed', 'Approved', 'Paid', 'Status'].map((h) => (
                <th key={h} className="text-left font-medium px-3 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!list.data ? (
              <tr><td colSpan={8} className="px-3 py-6 text-gray-400">Loading…</td></tr>
            ) : list.data.rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">No batches yet.</td></tr>
            ) : (
              list.data.rows.map((b) => <BatchRow key={b.id} b={b} onOpen={() => setOpenId(b.id)} />)
            )}
          </tbody>
        </table>
      </div>

      {list.data && (
        <Pagination page={page} total={list.data.total} pageSize={list.data.pageSize} noun="batches" onPage={setPage} />
      )}

      {neu && <NewBatchModal onClose={() => setNeu(false)} onCreated={(id) => { setNeu(false); setOpenId(id) }} />}
      <BatchDetailDrawer batchId={openId} open={!!openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

function BatchRow({ b, onOpen }: { b: ClaimBatchDTO; onOpen: () => void }) {
  const m = CLAIM_BATCH_STATUS_META[b.status]
  const d = (iso: string) => new Date(iso).toLocaleDateString('en-GB')
  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={onOpen}>
      <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{b.batchNumber}</td>
      <td className="px-3 py-2.5 text-gray-800">{b.providerName}</td>
      <td className="px-3 py-2.5 text-gray-500">{d(b.periodStart)} to {d(b.periodEnd)}</td>
      <td className="px-3 py-2.5 text-gray-600">{b.claimCount}</td>
      <td className="px-3 py-2.5">{naira(b.claimedTotal)}</td>
      <td className="px-3 py-2.5 text-gray-500">{naira(b.approvedTotal)}</td>
      <td className="px-3 py-2.5 text-gray-500">{naira(b.paidTotal)}</td>
      <td className="px-3 py-2.5">
        <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: m.color, backgroundColor: m.bg }}>{m.label}</span>
      </td>
    </tr>
  )
}

function NewBatchModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient()
  const [providerId, setProviderId] = useState('')
  const [from, setFrom] = useState(monthAgoISO())
  const [to, setTo] = useState(todayISO())
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState('')

  const create = useMutation({
    mutationFn: () =>
      claimsApi.batches.create({ providerId, periodStart: from, periodEnd: to, notes: notes.trim() || undefined }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ['claim-batches'] })
      qc.invalidateQueries({ queryKey: ['claims'] })
      onCreated(b.id)
    },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not create the batch.'),
  })

  return (
    <Modal open onClose={onClose} title="New batch" width={520} align="center">
      <div className="space-y-3">
        <Field label="Provider" required><ProviderSelect value={providerId} onChange={setProviderId} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Period from"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Period to"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-gray-500">
          All unbatched submitted claims for this provider with a service date in the period are added. You can adjust the
          contents before submitting.
        </p>
        <Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={!providerId} onClick={() => { setErr(''); create.mutate() }}>Create batch</Button>
        </div>
      </div>
    </Modal>
  )
}
