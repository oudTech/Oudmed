'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Field, Input, Modal } from '@/components/ui/kit'
import { claimsApi, naira } from '@/lib/claims'
import { ProviderSelect } from './ProviderSelect'

const todayISO = () => new Date().toISOString().slice(0, 10)
const monthAgoISO = () => {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 10)
}

export function GenerateClaimsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [providerId, setProviderId] = useState('')
  const [from, setFrom] = useState(monthAgoISO())
  const [to, setTo] = useState(todayISO())
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<string | null>(null)

  const eligible = useQuery({
    queryKey: ['eligible-visits', providerId, from, to],
    queryFn: () => claimsApi.eligibleVisits({ providerId: providerId || undefined, from, to }),
    enabled: open,
  })

  const gen = useMutation({
    mutationFn: () => claimsApi.generate([...picked]),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['claims'] })
      qc.invalidateQueries({ queryKey: ['claim-receivables'] })
      const parts = [`${res.created.length} claim${res.created.length === 1 ? '' : 's'} created`]
      if (res.skipped.length) parts.push(`${res.skipped.length} skipped`)
      setResult(parts.join(', '))
      setPicked(new Set())
      eligible.refetch()
    },
  })

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  const rows = eligible.data ?? []
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.visitId))

  return (
    <Modal open={open} onClose={onClose} title="Generate claims" width={720} align="center">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Provider"><ProviderSelect value={providerId} onChange={setProviderId} includeAll /></Field>
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>

        <p className="text-xs text-gray-500">
          Completed HMO / NHIS / company visits in this window whose invoice has no claim yet.
        </p>

        <div className="border border-gray-100 rounded-xl overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-500 sticky top-0">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={allPicked}
                    onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.visitId)) : new Set())}
                  />
                </th>
                {['Patient', 'Provider', 'Service date', 'Invoice total'].map((h) => (
                  <th key={h} className="text-left font-medium px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!eligible.data ? (
                <tr><td colSpan={5} className="px-3 py-6 text-gray-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">No eligible visits.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.visitId} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => toggle(r.visitId)}>
                    <td className="px-3 py-2"><input type="checkbox" checked={picked.has(r.visitId)} readOnly /></td>
                    <td className="px-3 py-2 text-gray-800">{r.patientName}<span className="block text-xs text-gray-400">{r.patientNumber}</span></td>
                    <td className="px-3 py-2 text-gray-600">{r.providerName ?? <span className="text-amber-600">no provider</span>}</td>
                    <td className="px-3 py-2 text-gray-500">{new Date(r.serviceDate).toLocaleDateString('en-GB')}</td>
                    <td className="px-3 py-2">{naira(r.invoiceTotal)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {result && <p className="text-sm text-emerald-700">{result}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button loading={gen.isPending} disabled={picked.size === 0} onClick={() => { setResult(null); gen.mutate() }}>
            Generate {picked.size > 0 ? `(${picked.size})` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
