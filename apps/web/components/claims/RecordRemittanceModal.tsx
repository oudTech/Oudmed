'use client'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { OpenClaimDTO, ShortfallAction } from '@oudhealth/contracts'
import { Button, Field, Input, Modal, Select } from '@/components/ui/kit'
import { claimsApi, naira, SHORTFALL_ACTIONS } from '@/lib/claims'
import { ProviderSelect } from './ProviderSelect'

type Row = { approved: string; paid: string; shortfallAction: ShortfallAction | '' }

const todayISO = () => new Date().toISOString().slice(0, 10)

export function RecordRemittanceModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [providerId, setProviderId] = useState('')
  const [receivedAmount, setReceivedAmount] = useState('')
  const [reference, setReference] = useState('')
  const [receivedAt, setReceivedAt] = useState(todayISO())
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [err, setErr] = useState('')

  const openClaims = useQuery({
    queryKey: ['remittance-open-claims', providerId],
    queryFn: () => claimsApi.remittances.openClaims(providerId),
    enabled: !!providerId,
  })

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((s) => ({ ...s, [id]: { ...{ approved: '', paid: '', shortfallAction: '' as const }, ...s[id], ...patch } }))

  const allocations = useMemo(
    () =>
      Object.entries(rows)
        .filter(([, r]) => r.approved !== '' || r.paid !== '')
        .map(([claimId, r]) => ({
          claimId,
          approvedAmount: Number(r.approved || 0),
          paidAmount: Number(r.paid || 0),
          shortfallAction: r.shortfallAction || undefined,
        })),
    [rows],
  )
  const allocatedPaid = allocations.reduce((s, a) => s + a.paidAmount, 0)
  const variance = Number(receivedAmount || 0) - allocatedPaid

  const create = useMutation({
    mutationFn: () =>
      claimsApi.remittances.create({
        providerId,
        receivedAmount: Number(receivedAmount),
        reference: reference.trim() || undefined,
        receivedAt,
        allocations,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claim-remittances'] })
      qc.invalidateQueries({ queryKey: ['claims'] })
      qc.invalidateQueries({ queryKey: ['claim-receivables'] })
      qc.invalidateQueries({ queryKey: ['billing-invoices'] })
      onClose()
    },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not record the remittance.'),
  })

  return (
    <Modal open onClose={onClose} title="Record remittance" width={820} align="center">
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-3">
          <Field label="Provider" required><ProviderSelect value={providerId} onChange={setProviderId} /></Field>
          <Field label="Amount received" required>
            <Input type="number" value={receivedAmount} onChange={(e) => setReceivedAmount(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Date received"><Input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} /></Field>
          <Field label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Cheque / transfer ref" /></Field>
        </div>

        {providerId && (
          <div className="border border-gray-100 rounded-xl overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-gray-50 text-gray-500 sticky top-0">
                <tr>
                  {['Claim #', 'Patient', 'Claimed', 'Approved', 'Paid now', 'Shortfall handling'].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!openClaims.data ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-gray-400">Loading…</td></tr>
                ) : openClaims.data.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">No open claims for this provider.</td></tr>
                ) : (
                  openClaims.data.map((c: OpenClaimDTO) => {
                    const r = rows[c.id] ?? { approved: '', paid: '', shortfallAction: '' }
                    const shortfall = Number(c.claimedAmount) - Number(r.approved || 0)
                    return (
                      <tr key={c.id} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-mono text-xs text-gray-600">{c.claimNumber}</td>
                        <td className="px-3 py-2 text-gray-800">{c.patientName}</td>
                        <td className="px-3 py-2">{naira(c.claimedAmount)}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={r.approved}
                            onChange={(e) => setRow(c.id, { approved: e.target.value })}
                            className="w-24 border border-gray-200 rounded px-2 py-1 text-sm"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            value={r.paid}
                            onChange={(e) => setRow(c.id, { paid: e.target.value })}
                            className="w-24 border border-gray-200 rounded px-2 py-1 text-sm"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-3 py-2">
                          {shortfall > 0.005 && (r.approved !== '') ? (
                            <select
                              value={r.shortfallAction}
                              onChange={(e) => setRow(c.id, { shortfallAction: e.target.value as ShortfallAction | '' })}
                              className="border border-gray-200 rounded px-2 py-1 text-sm"
                            >
                              <option value="">Leave outstanding</option>
                              {SHORTFALL_ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                            </select>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {providerId && (
          <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2 text-sm">
            <span className="text-gray-500">Allocated {naira(allocatedPaid)} of {naira(Number(receivedAmount || 0))}</span>
            <span className={Math.abs(variance) < 0.005 ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}>
              {Math.abs(variance) < 0.005 ? 'Balanced' : variance > 0 ? `${naira(variance)} unallocated` : `${naira(-variance)} over-allocated`}
            </span>
          </div>
        )}

        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={create.isPending}
            disabled={!providerId || !receivedAmount || allocations.length === 0}
            onClick={() => { setErr(''); create.mutate() }}
          >
            Record remittance
          </Button>
        </div>
      </div>
    </Modal>
  )
}
