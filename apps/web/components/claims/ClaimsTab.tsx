'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ClaimListItemDTO } from '@oudhealth/contracts'
import { Button } from '@/components/ui/kit'
import { claimsApi, CLAIM_STATUS_META, CLAIM_STATUS_CHIPS, naira } from '@/lib/claims'
import { Pagination } from '@/components/admin/AdminRowActions'
import { ProviderSelect } from './ProviderSelect'
import { GenerateClaimsModal } from './GenerateClaimsModal'
import { ClaimDetailDrawer } from './ClaimDetailDrawer'

export function ClaimsTab({
  providerFilter,
  onProviderFilter,
}: {
  providerFilter: string
  onProviderFilter: (id: string) => void
}) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [gen, setGen] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['claims', search, status, providerFilter, page],
    queryFn: () =>
      claimsApi.list({
        search: search || undefined,
        status: status || undefined,
        providerId: providerFilter || undefined,
        page,
      }),
  })
  const summary = list.data?.summary

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <Stat label="Outstanding" value={summary ? naira(summary.outstanding) : '-'} hint="submitted, not yet paid" />
        <Stat label="Aged over 90 days" value={summary ? naira(summary.aging.b90p) : '-'} hint="chase these first" tone="#B42318" />
        <Stat label="Approved, unpaid" value={summary ? naira(summary.approvedUnpaid) : '-'} hint="HMO agreed, money not in" tone="#B45309" />
        <Stat label="Rejected claims" value={summary ? String(summary.rejectedCount) : '-'} hint="need appeal or write-off" tone="#B42318" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search claim #, member or patient"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-72"
        />
        {CLAIM_STATUS_CHIPS.map((c) => (
          <button
            key={c.value}
            onClick={() => { setStatus(c.value); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${status === c.value ? 'bg-blue-50 text-primary' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            {c.label}
          </button>
        ))}
        <div className="flex-1" />
        <ProviderSelect value={providerFilter} onChange={(id) => { onProviderFilter(id); setPage(1) }} includeAll className="w-48" />
        <Button onClick={() => setGen(true)}>Generate claims</Button>
      </div>

      <div className="border border-gray-100 rounded-xl overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              {['Claim #', 'Patient', 'Provider', 'Service date', 'Claimed', 'Approved', 'Paid', 'Outstanding', 'Status'].map((h) => (
                <th key={h} className="text-left font-medium px-3 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!list.data ? (
              <tr><td colSpan={9} className="px-3 py-6 text-gray-400">Loading…</td></tr>
            ) : list.data.rows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">No claims match this view.</td></tr>
            ) : (
              list.data.rows.map((c) => <ClaimRow key={c.id} c={c} onOpen={() => setOpenId(c.id)} />)
            )}
          </tbody>
        </table>
      </div>

      {list.data && (
        <Pagination page={page} total={list.data.total} pageSize={list.data.pageSize} noun="claims" onPage={setPage} />
      )}

      <GenerateClaimsModal open={gen} onClose={() => setGen(false)} />
      <ClaimDetailDrawer claimId={openId} open={!!openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

function ClaimRow({ c, onOpen }: { c: ClaimListItemDTO; onOpen: () => void }) {
  const m = CLAIM_STATUS_META[c.status]
  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={onOpen}>
      <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{c.claimNumber}</td>
      <td className="px-3 py-2.5 text-gray-800">{c.patientName}</td>
      <td className="px-3 py-2.5 text-gray-500">{c.providerName}</td>
      <td className="px-3 py-2.5 text-gray-500">{new Date(c.serviceDate).toLocaleDateString('en-GB')}</td>
      <td className="px-3 py-2.5">{naira(c.claimedAmount)}</td>
      <td className="px-3 py-2.5 text-gray-500">{c.approvedAmount != null ? naira(c.approvedAmount) : '-'}</td>
      <td className="px-3 py-2.5 text-gray-500">{naira(c.paidAmount)}</td>
      <td className="px-3 py-2.5 font-medium">{naira(c.outstanding)}</td>
      <td className="px-3 py-2.5">
        <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: m.color, backgroundColor: m.bg }}>{m.label}</span>
      </td>
    </tr>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="border border-gray-100 rounded-xl p-4 bg-white">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: tone ?? '#111827' }}>{value}</p>
      <p className="text-xs text-gray-400 mt-1">{hint}</p>
    </div>
  )
}
