'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui/kit'
import { getDepartments } from '@/lib/hospital'
import { staffApi, HR_ROLES } from '@/lib/hr'

const BLANK = {
  firstName: '', lastName: '', email: '', phone: '',
  role: 'DOCTOR', jobTitle: '', notes: '',
  password: '', confirm: '',
}

export function AddUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ ...BLANK })
  const [deptIds, setDeptIds] = useState<string[]>([])
  const [err, setErr] = useState('')
  const set = (k: keyof typeof BLANK, v: string) => setF((s) => ({ ...s, [k]: v }))

  const departments = useQuery({ queryKey: ['departments'], queryFn: getDepartments, enabled: open })

  const m = useMutation({
    mutationFn: () =>
      staffApi.create({
        firstName: f.firstName.trim(),
        lastName: f.lastName.trim(),
        email: f.email.trim(),
        phone: f.phone.trim() || undefined,
        role: f.role,
        jobTitle: f.jobTitle.trim() || undefined,
        notes: f.notes.trim() || undefined,
        departmentIds: deptIds.length ? deptIds : undefined,
        password: f.password,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] })
      setF({ ...BLANK }); setDeptIds([]); setErr('')
      onClose()
    },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not add the user.'),
  })

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())
  const valid =
    f.firstName.trim() && f.lastName.trim() && emailOk &&
    f.password.length >= 8 && f.password === f.confirm

  const toggleDept = (id: string) =>
    setDeptIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  return (
    <Modal open={open} onClose={onClose} title="Add user" width={620} align="center">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" required><Input value={f.firstName} onChange={(e) => set('firstName', e.target.value)} placeholder="Joe" /></Field>
          <Field label="Last name" required><Input value={f.lastName} onChange={(e) => set('lastName', e.target.value)} placeholder="Doe" /></Field>
          <Field label="Email" required><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="joe@example.com" /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="08107355412" /></Field>
          <Field label="Role" required>
            <Select value={f.role} onChange={(e) => set('role', e.target.value)}>
              {HR_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </Field>
          <Field label="Specialty"><Input value={f.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} placeholder="Consultant" /></Field>
        </div>

        <Field label="Department(s)">
          <div className="flex flex-wrap gap-2">
            {(departments.data ?? []).map((dep) => (
              <button
                key={dep.id}
                type="button"
                onClick={() => toggleDept(dep.id)}
                className={`px-3 py-1.5 rounded-lg text-sm border ${deptIds.includes(dep.id) ? 'border-primary bg-blue-50 text-primary' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                {dep.name}
              </button>
            ))}
            {departments.data && departments.data.length === 0 && (
              <span className="text-sm text-gray-400">No departments configured.</span>
            )}
          </div>
        </Field>

        <Field label="Comments"><Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Password" required><Input type="password" value={f.password} onChange={(e) => set('password', e.target.value)} placeholder="At least 8 characters" /></Field>
          <Field label="Confirm password" required><Input type="password" value={f.confirm} onChange={(e) => set('confirm', e.target.value)} /></Field>
        </div>
        {f.confirm && f.password !== f.confirm && (
          <p className="text-xs text-red-600">Passwords do not match.</p>
        )}
        <p className="text-xs text-gray-400">
          The new staff member signs in at your hospital subdomain with this email and password. They can
          change it later from their account settings.
        </p>

        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={!valid} onClick={() => m.mutate()}>Add user</Button>
        </div>
      </div>
    </Modal>
  )
}
