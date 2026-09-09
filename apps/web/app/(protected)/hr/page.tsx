'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { StaffListItemDTO } from '@oudhealth/contracts'
import { Button } from '@/components/ui/kit'
import { can } from '@/lib/permissions'
import { staffApi, HR_ROLES, ROLE_LABEL, ROLE_BADGE } from '@/lib/hr'
import { AddUserModal } from '@/components/hr/AddUserModal'
import { StaffDetailDrawer } from '@/components/hr/StaffDetailDrawer'

export default function HrPage() {
  const { data: session } = useSession()
  const allowed = can(session?.role, 'staff:manage')

  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [add, setAdd] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['staff', search, role, status, page],
    queryFn: () => staffApi.list({ search: search || undefined, role: role || undefined, status, page }),
    enabled: allowed,
  })

  if (!allowed) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Human Resources</h1>
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6">
          Only a hospital admin can manage staff.
        </p>
      </div>
    )
  }

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="px-8 pt-7 pb-4 flex items-center justify-between flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-900">Human Resources</h1>
        <Button onClick={() => setAdd(true)}>+ Add user</Button>
      </div>
      <div className="border-b border-[#D6DEE8] flex-shrink-0" />

      <div className="flex-1 overflow-y-auto p-8">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search name, email or phone"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-72"
          />
          <button
            onClick={() => { setRole(''); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${role === '' ? 'bg-blue-50 text-primary' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            All
          </button>
          {HR_ROLES.map((r) => (
            <button
              key={r.value}
              onClick={() => { setRole(r.value); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${role === r.value ? 'bg-blue-50 text-primary' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              {r.label}
            </button>
          ))}
          <div className="flex-1" />
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1) }}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div data-tour="hr-main" className="border border-gray-100 rounded-xl overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                {['Name', 'Role', 'Phone', 'Department(s)', 'Comments', 'Status', ''].map((h) => (
                  <th key={h} className="text-left font-medium px-3 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!list.data ? (
                <tr><td colSpan={7} className="px-3 py-6 text-gray-400">Loading…</td></tr>
              ) : list.data.staff.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-6 text-gray-400 text-center">No staff match this view.</td></tr>
              ) : (
                list.data.staff.map((s) => <StaffRow key={s.id} s={s} onOpen={() => setOpenId(s.id)} />)
              )}
            </tbody>
          </table>
        </div>

        {list.data && list.data.total > list.data.pageSize && (
          <div className="flex items-center justify-between mt-4 text-sm">
            <span className="text-gray-400">
              Showing {(page - 1) * list.data.pageSize + 1} to {Math.min(page * list.data.pageSize, list.data.total)} of {list.data.total} users
            </span>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="w-7 h-7 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50">‹</button>
              <span className="px-2 text-gray-600">{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="w-7 h-7 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50">›</button>
            </div>
          </div>
        )}
      </div>

      <AddUserModal open={add} onClose={() => setAdd(false)} />
      <StaffDetailDrawer staffId={openId} open={!!openId} onClose={() => setOpenId(null)} selfEmail={session?.user?.email} />
    </div>
  )
}

function StaffRow({ s, onOpen }: { s: StaffListItemDTO; onOpen: () => void }) {
  const badge = ROLE_BADGE[s.role] ?? ROLE_BADGE.ACCOUNTANT
  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={onOpen}>
      <td className="px-3 py-2.5">
        <span className="font-medium text-gray-900">{s.fullName}</span>
        <span className="block text-xs text-gray-400">{s.email}</span>
      </td>
      <td className="px-3 py-2.5">
        <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: badge.color, backgroundColor: badge.bg }}>
          {ROLE_LABEL[s.role] ?? s.role}
        </span>
      </td>
      <td className="px-3 py-2.5 text-gray-600">{s.phone ?? '-'}</td>
      <td className="px-3 py-2.5 text-gray-600">
        {s.departments.length ? s.departments.map((x) => x.name).join(', ') : '-'}
      </td>
      <td className="px-3 py-2.5 text-gray-500 max-w-xs truncate">{s.notes ?? '-'}</td>
      <td className="px-3 py-2.5">
        <span
          className="text-xs font-medium rounded-full px-2 py-0.5"
          style={s.isActive ? { color: '#047857', backgroundColor: '#EAF7F0' } : { color: '#6B7280', backgroundColor: '#F3F4F6' }}
        >
          {s.accountStatus}
        </span>
      </td>
      <td className="px-3 py-2.5 text-gray-300">⋮</td>
    </tr>
  )
}
