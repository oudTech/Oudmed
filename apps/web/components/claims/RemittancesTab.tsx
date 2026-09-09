'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ClaimRemittanceDTO } from '@oudhealth/contracts'
import { Button } from '@/components/ui/kit'
import { claimsApi, naira } from '@/lib/claims'
import { Pagination } from '@/components/admin/AdminRowActions'
import { RecordRemittanceModal } from './RecordRemittanceModal'
import { RemittanceDetailDrawer } from './RemittanceDetailDrawer'

const d = (iso: string) => new Date(iso).toLocaleDateString('en-GB')

export function RemittancesTab() {
  const [page, setPage] = useState(1)
  const [rec, setRec] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['claim-remittances', page],
    queryFn: () => claimsApi.remittances.list({ page }),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">Record what an HMO actually paid and allocate it across the claims it settles.</p>
        <Button onClick={() => setRec(true)}>Record remittance</Button>
      </div>

      <div className="border border-gray-100 rounded-xl overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              {['Remittance #', 'Provider', 'Received', 'Amount', 'Allocated', 'Claims', 'Reference', ''].map((h) => (
                <th key={h} className="text-left font-medium px-3 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!list.data ? (
              <tr><td colSpan={8} className="px-3 py-6 text-gray-400">Loading…</td></tr>
            ) : list.data.rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">No remittances recorded.</td></tr>
            ) : (
              list.data.rows.map((r) => <RemRow key={r.id} r={r} onOpen={() => setOpenId(r.id)} />)
            )}
          </tbody>
        </table>
      </div>

      {list.data && (
        <Pagination page={page} total={list.data.total} pageSize={list.data.pageSize} noun="remittances" onPage={setPage} />
      )}

      {rec && <RecordRemittanceModal onClose={() => setRec(false)} />}
      <RemittanceDetailDrawer remittanceId={openId} open={!!openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

function RemRow({ r, onOpen }: { r: ClaimRemittanceDTO; onOpen: () => void }) {
  const variance = Number(r.receivedAmount) - Number(r.allocatedAmount)
  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={onOpen}>
      <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{r.remittanceNumber}</td>
      <td className="px-3 py-2.5 text-gray-800">{r.providerName}</td>
      <td className="px-3 py-2.5 text-gray-500">{d(r.receivedAt)}</td>
      <td className="px-3 py-2.5">{naira(r.receivedAmount)}</td>
      <td className="px-3 py-2.5 text-gray-600">
        {naira(r.allocatedAmount)}
        {Math.abs(variance) > 0.005 && (
          <span className="ml-1.5 text-xs text-amber-600">
            ({variance > 0 ? 'unallocated ' : 'over '}{naira(Math.abs(variance))})
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-gray-600">{r.claimCount}</td>
      <td className="px-3 py-2.5 text-gray-500">{r.reference ?? '-'}</td>
      <td className="px-3 py-2.5">
        {r.reversedAt && <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: '#B42318', backgroundColor: '#FEECEB' }}>Reversed</span>}
      </td>
    </tr>
  )
}
