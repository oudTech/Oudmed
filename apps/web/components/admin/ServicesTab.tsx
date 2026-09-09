'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ServiceItemAdminDTO } from '@oudhealth/contracts'
import { Button, Field, Input, Modal, Select } from '@/components/ui/kit'
import { adminApi, naira, SERVICE_CATEGORIES } from '@/lib/admin'
import { AdminRowActions, Pagination, StatusPill } from './AdminRowActions'

export function ServicesTab() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; row: ServiceItemAdminDTO } | null>(null)

  const list = useQuery({
    queryKey: ['admin-services', search, category, status, page],
    queryFn: () => adminApi.services.list({ search: search || undefined, category: category || undefined, status, page }),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-services'] })
  const toggle = useMutation({ mutationFn: (id: string) => adminApi.services.toggle(id), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (id: string) => adminApi.services.remove(id), onSuccess: invalidate })

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search name or code"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-72"
        />
        <button
          onClick={() => { setCategory(''); setPage(1) }}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${category === '' ? 'bg-blue-50 text-primary' : 'text-gray-500 hover:bg-gray-50'}`}
        >
          All
        </button>
        {SERVICE_CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => { setCategory(c); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${category === c ? 'bg-blue-50 text-primary' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            {c}
          </button>
        ))}
        <div className="flex-1" />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="w-36">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Button onClick={() => setModal({ mode: 'add' })}>+ Add service</Button>
      </div>

      <div className="border border-gray-100 rounded-xl overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              {['Code', 'Name', 'Category', 'Price', 'Status', ''].map((h) => (
                <th key={h} className="text-left font-medium px-3 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!list.data ? (
              <tr><td colSpan={6} className="px-3 py-6 text-gray-400">Loading…</td></tr>
            ) : list.data.rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-gray-400 text-center">No services match this view.</td></tr>
            ) : (
              list.data.rows.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2.5 font-mono text-xs text-gray-500">{row.code ?? '-'}</td>
                  <td className="px-3 py-2.5 font-medium text-gray-900">{row.name}</td>
                  <td className="px-3 py-2.5 text-gray-500">{row.category ?? '-'}</td>
                  <td className="px-3 py-2.5 text-gray-700">{naira(row.unitPrice)}</td>
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
        <Pagination page={page} total={list.data.total} pageSize={list.data.pageSize} noun="services" onPage={setPage} />
      )}

      {modal && (
        <ServiceModal
          key={modal.mode === 'edit' ? modal.row.id : 'add'}
          row={modal.mode === 'edit' ? modal.row : null}
          onClose={() => setModal(null)}
          onSaved={() => { invalidate(); setModal(null) }}
        />
      )}
    </div>
  )
}

function ServiceModal({
  row,
  onClose,
  onSaved,
}: {
  row: ServiceItemAdminDTO | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(row?.name ?? '')
  const [code, setCode] = useState(row?.code ?? '')
  const [category, setCategory] = useState(row?.category ?? SERVICE_CATEGORIES[0])
  const [price, setPrice] = useState(row ? String(row.unitPrice) : '')
  const [active, setActive] = useState(row?.isActive ?? true)
  const [err, setErr] = useState('')

  const priceNum = Number(price)
  const valid = name.trim().length >= 2 && Number.isFinite(priceNum) && priceNum >= 0 && price !== ''

  const m = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        code: code.trim() || undefined,
        category: category || undefined,
        unitPrice: priceNum,
      }
      if (row) {
        await adminApi.services.update(row.id, payload)
        if (active !== row.isActive) await adminApi.services.toggle(row.id)
      } else {
        const created = await adminApi.services.create(payload)
        if (!active) await adminApi.services.toggle(created.id)
      }
    },
    onSuccess: onSaved,
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not save the service.'),
  })

  return (
    <Modal open onClose={onClose} title={row ? 'Edit service' : 'Add service'} width={520} align="center">
      <div className="space-y-3">
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Electrolytes / Urea / Creatinine" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Service code"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SVC-013" /></Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {SERVICE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Price (₦)" required>
            <Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Status">
            <Select value={active ? 'active' : 'inactive'} onChange={(e) => setActive(e.target.value === 'active')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
        </div>
        <p className="text-xs text-gray-400">
          Active services appear in the billing "Add item" picker and the encounter order picker.
        </p>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={!valid} onClick={() => m.mutate()}>
            {row ? 'Save changes' : 'Add service'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
