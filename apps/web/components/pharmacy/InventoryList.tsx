'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { DrugListItemDTO, DrugStatDTO } from '@oudhealth/contracts'
import { Button } from '@/components/ui/kit'
import { can } from '@/lib/permissions'
import { drugsApi, STOCK_STATUS_META } from '@/lib/pharmacy'
import { AddDrugModal } from './AddDrugModal'
import { DrugDetailModal } from './DrugDetailModal'
import { ImportDrugsModal } from './ImportDrugsModal'

const naira = (v: string) => '₦' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })

const FILTERS = [
  ['all', 'All'],
  ['low', 'Low stock'],
  ['out', 'Out of stock'],
  ['expiring', 'Expiring'],
] as const

export function InventoryList() {
  const { data: session } = useSession()
  const canManage = can(session?.role, 'pharmacy:manage')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [add, setAdd] = useState(false)
  const [importing, setImporting] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const stats = useQuery({ queryKey: ['drug-stats'], queryFn: drugsApi.stats })
  const list = useQuery({
    queryKey: ['drugs', search, filter, page],
    queryFn: () => drugsApi.list({ search: search || undefined, filter, page }),
  })

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1

  return (
    <div className="p-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatCard label="Total drugs" stat={stats.data?.totalDrugs} hint="in the formulary" />
        <StatCard label="Low stock" stat={stats.data?.lowStock} hint="at or below reorder level" tone="#B45309" />
        <StatCard label="Out of stock" stat={stats.data?.outOfStock} hint="nothing on hand" tone="#B42318" />
        <StatCard label="Expiring soon" stat={stats.data?.expiringSoon} hint="a batch within 60 days" tone="#B45309" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search name, generic or SKU"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-72"
        />
        {FILTERS.map(([v, l]) => (
          <button
            key={v}
            onClick={() => { setFilter(v); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filter === v ? 'bg-blue-50 text-primary' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            {l}
          </button>
        ))}
        <div className="flex-1" />
        {canManage && (
          <>
            <Button variant="secondary" onClick={() => setImporting(true)}>Upload CSV</Button>
            <Button onClick={() => setAdd(true)}>+ Add item</Button>
          </>
        )}
      </div>

      <div className="border border-gray-100 rounded-xl overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              {['SKU', 'Item name', 'Form / strength', 'Package', 'Quantity', 'Price', ''].map((h) => (
                <th key={h} className="text-left font-medium px-3 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!list.data ? (
              <tr><td colSpan={7} className="px-3 py-6 text-gray-400">Loading…</td></tr>
            ) : list.data.drugs.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-gray-400 text-center">No drugs match this view.</td></tr>
            ) : (
              list.data.drugs.map((row) => (
                <DrugRow key={row.id} row={row} onOpen={() => setOpenId(row.id)} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {list.data && list.data.total > list.data.pageSize && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-gray-400">
            Showing {(page - 1) * list.data.pageSize + 1} to {Math.min(page * list.data.pageSize, list.data.total)} of {list.data.total} drugs
          </span>
          <div className="flex items-center gap-1">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="w-7 h-7 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50">‹</button>
            <span className="px-2 text-gray-600">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="w-7 h-7 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50">›</button>
          </div>
        </div>
      )}

      <AddDrugModal open={add} onClose={() => setAdd(false)} />
      <ImportDrugsModal open={importing} onClose={() => setImporting(false)} />
      <DrugDetailModal drugId={openId} open={!!openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

function DrugRow({ row, onOpen }: { row: DrugListItemDTO; onOpen: () => void }) {
  const m = STOCK_STATUS_META[row.stockStatus]
  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={onOpen}>
      <td className="px-3 py-2.5 font-mono text-xs text-gray-500">{row.sku}</td>
      <td className="px-3 py-2.5">
        <span className="font-medium text-gray-900">{row.name}</span>
        {row.genericName && row.genericName !== row.name && (
          <span className="text-gray-400 text-xs ml-1">({row.genericName})</span>
        )}
        {row.expiringSoon && (
          <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600">expiring</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-gray-500">{[row.form, row.strength].filter(Boolean).join(' · ') || '-'}</td>
      <td className="px-3 py-2.5 text-gray-500">{row.packaging}</td>
      <td className="px-3 py-2.5">
        <span className="mr-2">{row.quantityOnHand}</span>
        {row.stockStatus !== 'OK' && (
          <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: m.color, backgroundColor: m.bg }}>
            {m.label}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5">{naira(row.sellPrice)}</td>
      <td className="px-3 py-2.5 text-gray-300">⋮</td>
    </tr>
  )
}

function StatCard({
  label,
  stat,
  hint,
  tone,
}: {
  label: string
  stat?: DrugStatDTO
  hint: string
  tone?: string
}) {
  return (
    <div className="border border-gray-100 rounded-xl p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: tone ?? '#111827' }}>
        {stat ? stat.total : '-'}
      </p>
      <p className="text-xs text-gray-400 mt-1">
        {stat?.addedThisMonth ? `+${stat.addedThisMonth} added this month` : hint}
      </p>
    </div>
  )
}
