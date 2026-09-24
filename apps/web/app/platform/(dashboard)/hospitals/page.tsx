'use client'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PlatformTenantSummaryDTO } from '@oudhealth/contracts'
import { Button, Select } from '@/components/ui/kit'
import { Pagination } from '@/components/admin/AdminRowActions'
import { useConfirm, useToast } from '@/components/ui/feedback'
import { platformApiClient, naira, STATUS_BADGE, STATUS_LABEL } from '@/lib/platform'
import { AddHospitalModal } from '@/components/platform/AddHospitalModal'
import { HospitalDetailDrawer } from '@/components/platform/HospitalDetailDrawer'

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'
}

export default function HospitalsPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [addOpen, setAddOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const list = useQuery({
    queryKey: ['platform-hospitals', search, status, page],
    queryFn: () => platformApiClient.tenants.list({ search: search || undefined, status, page }),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['platform-hospitals'] })

  async function handleExport() {
    setExporting(true)
    try {
      await platformApiClient.tenants.exportCsv({ search: search || undefined, status })
    } catch {
      toast('Could not export hospitals.', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Hospitals</h1>
          <p className="text-sm text-gray-500 mt-1">Manage every hospital tenant on the platform.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" loading={exporting} onClick={handleExport}>Export</Button>
          <Button onClick={() => setAddOpen(true)}>+ Add hospital</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search for hospitals"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-72"
        />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="w-40">
          <option value="all">All status</option>
          <option value="trialing">Trialing</option>
          <option value="active">Active</option>
          <option value="past_due">Past due</option>
          <option value="suspended">Suspended</option>
        </Select>
      </div>

      <div className="border border-gray-100 rounded-xl overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              {['Hospital', 'Status', 'Users', 'Patients', 'MRR', 'Last activity', 'Joined', ''].map((h) => (
                <th key={h} className="text-left font-medium px-3 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!list.data ? (
              <tr><td colSpan={8} className="px-3 py-6 text-gray-400">Loading…</td></tr>
            ) : list.data.rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-gray-400 text-center">No hospitals match this view.</td></tr>
            ) : (
              list.data.rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setSelected(row.id)}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-blue-50 text-primary font-semibold flex items-center justify-center text-xs flex-shrink-0">
                        {initials(row.name)}
                      </div>
                      <span className="font-medium text-gray-900">{row.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className="text-xs font-medium rounded-full px-2 py-0.5"
                      style={{
                        color: (row.isActive ? STATUS_BADGE[row.subscriptionStatus] : STATUS_BADGE.SUSPENDED)?.color,
                        backgroundColor: (row.isActive ? STATUS_BADGE[row.subscriptionStatus] : STATUS_BADGE.SUSPENDED)?.bg,
                      }}
                    >
                      {row.isActive ? STATUS_LABEL[row.subscriptionStatus] ?? row.subscriptionStatus : 'Suspended'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{row.users}</td>
                  <td className="px-3 py-2.5 tabular-nums">{row.patients}</td>
                  <td className="px-3 py-2.5 tabular-nums">{naira(row.monthlyRevenue)}</td>
                  <td className="px-3 py-2.5 text-gray-500">
                    {row.lastActivityAt ? new Date(row.lastActivityAt).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-3 py-2.5 text-gray-500">{new Date(row.joinedAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <HospitalRowActions row={row} onChanged={invalidate} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {list.data && (
        <Pagination page={page} total={list.data.total} pageSize={list.data.pageSize} noun="hospitals" onPage={setPage} />
      )}

      <AddHospitalModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => { invalidate(); setAddOpen(false) }} />
      {selected && (
        <HospitalDetailDrawer tenantId={selected} onClose={() => setSelected(null)} onChanged={invalidate} />
      )}
    </div>
  )
}

function HospitalRowActions({ row, onChanged }: { row: PlatformTenantSummaryDTO; onChanged: () => void }) {
  const confirm = useConfirm()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const suspend = useMutation({
    mutationFn: () => platformApiClient.tenants.suspend(row.id),
    onSuccess: () => { onChanged(); setOpen(false); toast('Hospital suspended', 'success') },
  })
  const reactivate = useMutation({
    mutationFn: () => platformApiClient.tenants.reactivate(row.id),
    onSuccess: () => { onChanged(); setOpen(false); toast('Hospital reactivated', 'success') },
  })

  async function handleSuspend() {
    setOpen(false)
    const ok = await confirm({
      title: 'Suspend this hospital?',
      body: `${row.name} and every one of its staff will immediately lose access. This can be reversed at any time.`,
      confirmLabel: 'Suspend',
      danger: true,
    })
    if (ok) suspend.mutate()
  }

  return (
    <div className="relative flex justify-end" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-7 h-7 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        aria-label="Row actions"
      >
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-30 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg text-sm">
          {row.isActive ? (
            <button
              disabled={suspend.isPending}
              onClick={handleSuspend}
              className="block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50"
            >
              Suspend
            </button>
          ) : (
            <button
              disabled={reactivate.isPending}
              onClick={() => reactivate.mutate()}
              className="block w-full px-3 py-2 text-left text-emerald-600 hover:bg-emerald-50"
            >
              Reactivate
            </button>
          )}
        </div>
      )}
    </div>
  )
}
