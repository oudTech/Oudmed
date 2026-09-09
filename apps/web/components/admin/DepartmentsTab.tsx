'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DepartmentAdminDTO } from '@oudhealth/contracts'
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui/kit'
import { adminApi } from '@/lib/admin'
import { AdminRowActions, Pagination, StatusPill } from './AdminRowActions'

const STATUSES = [
  ['all', 'All statuses'],
  ['active', 'Active'],
  ['inactive', 'Inactive'],
] as const

export function DepartmentsTab() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; row: DepartmentAdminDTO } | null>(null)

  const list = useQuery({
    queryKey: ['admin-departments', search, status, page],
    queryFn: () => adminApi.departments.list({ search: search || undefined, status, page }),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-departments'] })
  const toggle = useMutation({ mutationFn: (id: string) => adminApi.departments.toggle(id), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (id: string) => adminApi.departments.remove(id), onSuccess: invalidate })

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search name or code"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-72"
        />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="w-40">
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <div className="flex-1" />
        <Button onClick={() => setModal({ mode: 'add' })}>+ Add department</Button>
      </div>

      <div className="border border-gray-100 rounded-xl overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              {['Name', 'Code', 'Phone', 'Staff', 'Comments', 'Status', ''].map((h) => (
                <th key={h} className="text-left font-medium px-3 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!list.data ? (
              <tr><td colSpan={7} className="px-3 py-6 text-gray-400">Loading…</td></tr>
            ) : list.data.rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-gray-400 text-center">No departments match this view.</td></tr>
            ) : (
              list.data.rows.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2.5 font-medium text-gray-900">{row.name}</td>
                  <td className="px-3 py-2.5 text-gray-500">{row.code ?? '-'}</td>
                  <td className="px-3 py-2.5 text-gray-600">{row.phone ?? '-'}</td>
                  <td className="px-3 py-2.5 text-gray-600">{row.userCount}</td>
                  <td className="px-3 py-2.5 text-gray-500 max-w-xs truncate">{row.notes ?? '-'}</td>
                  <td className="px-3 py-2.5"><StatusPill active={row.isActive} /></td>
                  <td className="px-3 py-2.5">
                    <AdminRowActions
                      isActive={row.isActive}
                      busy={remove.isPending}
                      onEdit={() => setModal({ mode: 'edit', row })}
                      onToggle={() => toggle.mutate(row.id)}
                      onDelete={() => remove.mutateAsync(row.id)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {list.data && (
        <Pagination page={page} total={list.data.total} pageSize={list.data.pageSize} noun="departments" onPage={setPage} />
      )}

      {modal && (
        <DepartmentModal
          key={modal.mode === 'edit' ? modal.row.id : 'add'}
          row={modal.mode === 'edit' ? modal.row : null}
          onClose={() => setModal(null)}
          onSaved={() => { invalidate(); setModal(null) }}
        />
      )}
    </div>
  )
}

function DepartmentModal({
  row,
  onClose,
  onSaved,
}: {
  row: DepartmentAdminDTO | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(row?.name ?? '')
  const [code, setCode] = useState(row?.code ?? '')
  const [phone, setPhone] = useState(row?.phone ?? '')
  const [notes, setNotes] = useState(row?.notes ?? '')
  const [active, setActive] = useState(row?.isActive ?? true)
  const [err, setErr] = useState('')

  const m = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        code: code.trim() || undefined,
        phone: phone.trim() || undefined,
        notes: notes.trim() || undefined,
      }
      if (row) {
        await adminApi.departments.update(row.id, payload)
        if (active !== row.isActive) await adminApi.departments.toggle(row.id)
      } else {
        const created = await adminApi.departments.create(payload)
        if (!active) await adminApi.departments.toggle(created.id)
      }
    },
    onSuccess: onSaved,
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not save the department.'),
  })

  return (
    <Modal open onClose={onClose} title={row ? 'Edit department' : 'Add department'} width={520} align="center">
      <div className="space-y-3">
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Physiotherapy" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. PHYSIO" /></Field>
          <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803..." /></Field>
        </div>
        <Field label="Status">
          <Select value={active ? 'active' : 'inactive'} onChange={(e) => setActive(e.target.value === 'active')}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
        <Field label="Comments"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={name.trim().length < 2} onClick={() => m.mutate()}>
            {row ? 'Save changes' : 'Add department'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
