'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { InsuranceProviderDTO } from '@oudhealth/contracts'
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui/kit'
import { adminApi, INSURANCE_KINDS, KIND_BADGE, KIND_LABEL } from '@/lib/admin'
import { AdminRowActions, Pagination, StatusPill } from './AdminRowActions'

export function ProvidersTab() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; row: InsuranceProviderDTO } | null>(null)

  const list = useQuery({
    queryKey: ['admin-providers', search, kind, status, page],
    queryFn: () => adminApi.providers.list({ search: search || undefined, kind: kind || undefined, status, page }),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-providers'] })
  const toggle = useMutation({ mutationFn: (id: string) => adminApi.providers.toggle(id), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (id: string) => adminApi.providers.remove(id), onSuccess: invalidate })

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search name or contact person"
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-72"
        />
        <button
          onClick={() => { setKind(''); setPage(1) }}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${kind === '' ? 'bg-blue-50 text-primary' : 'text-gray-500 hover:bg-gray-50'}`}
        >
          All
        </button>
        {INSURANCE_KINDS.map((k) => (
          <button
            key={k.value}
            onClick={() => { setKind(k.value); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${kind === k.value ? 'bg-blue-50 text-primary' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            {k.label}
          </button>
        ))}
        <div className="flex-1" />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="w-36">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Button onClick={() => setModal({ mode: 'add' })}>+ Add provider</Button>
      </div>

      <div className="border border-gray-100 rounded-xl overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              {['Name', 'Type', 'Phone', 'Contact person', 'Patients', 'Status', ''].map((h) => (
                <th key={h} className="text-left font-medium px-3 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!list.data ? (
              <tr><td colSpan={7} className="px-3 py-6 text-gray-400">Loading…</td></tr>
            ) : list.data.rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-gray-400 text-center">No providers match this view.</td></tr>
            ) : (
              list.data.rows.map((row) => {
                const badge = KIND_BADGE[row.kind] ?? KIND_BADGE.HMO
                return (
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2.5 font-medium text-gray-900">{row.name}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: badge.color, backgroundColor: badge.bg }}>
                        {KIND_LABEL[row.kind] ?? row.kind}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{row.phone ?? '-'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{row.contactPerson ?? '-'}</td>
                    <td className="px-3 py-2.5 text-gray-600">{row.patientCount}</td>
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
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {list.data && (
        <Pagination page={page} total={list.data.total} pageSize={list.data.pageSize} noun="providers" onPage={setPage} />
      )}

      {modal && (
        <ProviderModal
          key={modal.mode === 'edit' ? modal.row.id : 'add'}
          row={modal.mode === 'edit' ? modal.row : null}
          onClose={() => setModal(null)}
          onSaved={() => { invalidate(); setModal(null) }}
        />
      )}
    </div>
  )
}

function ProviderModal({
  row,
  onClose,
  onSaved,
}: {
  row: InsuranceProviderDTO | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(row?.name ?? '')
  const [kind, setKind] = useState(row?.kind ?? 'HMO')
  const [phone, setPhone] = useState(row?.phone ?? '')
  const [email, setEmail] = useState(row?.email ?? '')
  const [contactPerson, setContactPerson] = useState(row?.contactPerson ?? '')
  const [address, setAddress] = useState(row?.address ?? '')
  const [notes, setNotes] = useState(row?.notes ?? '')
  const [active, setActive] = useState(row?.isActive ?? true)
  const [err, setErr] = useState('')

  const m = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        kind,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        contactPerson: contactPerson.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
      }
      if (row) {
        await adminApi.providers.update(row.id, payload)
        if (active !== row.isActive) await adminApi.providers.toggle(row.id)
      } else {
        const created = await adminApi.providers.create(payload)
        if (!active) await adminApi.providers.toggle(created.id)
      }
    },
    onSuccess: onSaved,
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not save the provider.'),
  })

  return (
    <Modal open onClose={onClose} title={row ? 'Edit provider' : 'Add provider'} width={560} align="center">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Avon HMO" />
          </Field>
          <Field label="Type" required>
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {INSURANCE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </Select>
          </Field>
          <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803..." /></Field>
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="care@provider.com" /></Field>
          <Field label="Contact person"><Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="Relationship officer" /></Field>
          <Field label="Status">
            <Select value={active ? 'active' : 'inactive'} onChange={(e) => setActive(e.target.value === 'active')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
        </div>
        <Field label="Address"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label="Comments"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={name.trim().length < 2} onClick={() => m.mutate()}>
            {row ? 'Save changes' : 'Add provider'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
