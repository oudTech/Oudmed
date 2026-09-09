'use client'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { StaffDetailDTO } from '@oudhealth/contracts'
import { Button, Drawer, Field, Input, Select, Textarea } from '@/components/ui/kit'
import { getDepartments } from '@/lib/hospital'
import { staffApi, HR_ROLES, ROLE_LABEL } from '@/lib/hr'
import { DoctorHoursModal } from '@/components/schedule/DoctorHoursModal'

const d = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB') : 'Never')

export function StaffDetailDrawer({
  staffId,
  open,
  onClose,
  selfEmail,
}: {
  staffId: string | null
  open: boolean
  onClose: () => void
  selfEmail?: string | null
}) {
  const q = useQuery({
    queryKey: ['staff-detail', staffId],
    queryFn: () => staffApi.get(staffId!),
    enabled: open && !!staffId,
  })
  const s = q.data

  return (
    <Drawer open={open} onClose={onClose} title={s ? s.fullName : 'Staff member'} width={640}>
      {!s ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-6">
          <EditForm s={s} isSelf={!!selfEmail && s.email === selfEmail} onClose={onClose} />
          <div className="text-xs text-gray-400 space-y-1">
            <p>Last sign-in: {d(s.lastLoginAt)}</p>
            <p>Added {d(s.createdAt)}{s.invitedByName ? ` by ${s.invitedByName}` : ''}</p>
            {s.role === 'DOCTOR' && (
              <p>{s.assignedPatientCount} assigned patient(s) · {s.upcomingVisitCount} upcoming appointment(s)</p>
            )}
          </div>
        </div>
      )}
    </Drawer>
  )
}

function EditForm({ s, isSelf, onClose }: { s: StaffDetailDTO; isSelf: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [first, ...rest] = s.fullName.split(' ')
  const [f, setF] = useState({
    firstName: first ?? '',
    lastName: rest.join(' '),
    phone: s.phone ?? '',
    role: s.role as string,
    jobTitle: s.jobTitle ?? '',
    notes: s.notes ?? '',
  })
  const [deptIds, setDeptIds] = useState<string[]>(s.departments.map((x) => x.id))
  const [pw, setPw] = useState('')
  const [showHours, setShowHours] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    const [fn, ...rn] = s.fullName.split(' ')
    setF({
      firstName: fn ?? '', lastName: rn.join(' '), phone: s.phone ?? '',
      role: s.role, jobTitle: s.jobTitle ?? '', notes: s.notes ?? '',
    })
    setDeptIds(s.departments.map((x) => x.id))
    setPw('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.id])

  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))
  const departments = useQuery({ queryKey: ['departments'], queryFn: getDepartments })

  const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join()
  const dirty =
    f.firstName !== (first ?? '') ||
    f.lastName !== rest.join(' ') ||
    f.phone !== (s.phone ?? '') ||
    f.role !== s.role ||
    f.jobTitle !== (s.jobTitle ?? '') ||
    f.notes !== (s.notes ?? '') ||
    !sameSet(deptIds, s.departments.map((x) => x.id))

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['staff'] })
    qc.invalidateQueries({ queryKey: ['staff-detail', s.id] })
  }

  const save = useMutation({
    mutationFn: () =>
      staffApi.update(s.id, {
        firstName: f.firstName.trim(),
        lastName: f.lastName.trim(),
        phone: f.phone.trim(),
        role: f.role,
        jobTitle: f.jobTitle.trim(),
        notes: f.notes.trim(),
        departmentIds: deptIds,
      }),
    onSuccess: invalidate,
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not save.'),
  })

  const toggleActive = useMutation({
    mutationFn: () => (s.isActive ? staffApi.deactivate(s.id) : staffApi.activate(s.id)),
    onSuccess: invalidate,
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not change status.'),
  })

  const setPassword = useMutation({
    mutationFn: () => staffApi.setPassword(s.id, pw),
    onSuccess: () => { setPw(''); setErr('') },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not set the password.'),
  })

  const toggleDept = (id: string) =>
    setDeptIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name"><Input value={f.firstName} onChange={(e) => set('firstName', e.target.value)} /></Field>
        <Field label="Last name"><Input value={f.lastName} onChange={(e) => set('lastName', e.target.value)} /></Field>
        <Field label="Email"><Input value={s.email} disabled /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Role">
          <Select value={f.role} onChange={(e) => set('role', e.target.value)}>
            {HR_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            {!HR_ROLES.some((r) => r.value === s.role) && <option value={s.role}>{ROLE_LABEL[s.role] ?? s.role}</option>}
          </Select>
        </Field>
        <Field label="Specialty"><Input value={f.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} /></Field>
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
        </div>
      </Field>

      <Field label="Comments"><Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="flex items-center gap-3">
        <Button
          variant={s.isActive ? 'danger' : 'secondary'}
          loading={toggleActive.isPending}
          disabled={isSelf && s.isActive}
          title={isSelf && s.isActive ? 'You cannot deactivate your own account' : undefined}
          onClick={() => toggleActive.mutate()}
        >
          {s.isActive ? 'Deactivate' : 'Activate'}
        </Button>
        <Button variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
          Save changes
        </Button>
        {s.role === 'DOCTOR' && (
          <button className="text-sm font-medium text-primary hover:underline ml-auto" onClick={() => setShowHours(true)}>
            Working hours
          </button>
        )}
      </div>

      <div className="rounded-xl border border-gray-100 p-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Set a new password</p>
        <div className="flex items-end gap-3">
          <Field label="New password"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" /></Field>
          <Button variant="secondary" loading={setPassword.isPending} disabled={pw.length < 8} onClick={() => setPassword.mutate()}>Set password</Button>
        </div>
        {setPassword.isSuccess && !pw && <p className="text-xs text-green-600 mt-2">Password updated.</p>}
      </div>

      <DoctorHoursModal
        doctor={showHours ? { id: s.id, name: s.fullName } : null}
        onClose={() => setShowHours(false)}
      />
    </div>
  )
}
