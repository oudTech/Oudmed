'use client'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Modal, Field, Input, Select, Button } from '@/components/ui/kit'
import { patientsApi } from '@/lib/patients'
import { trackFirst } from '@/lib/onboarding/analytics'

const PAYERS = [
  { v: 'CASH', l: 'Cash / self-pay' },
  { v: 'HMO', l: 'HMO' },
  { v: 'NHIS', l: 'NHIS' },
  { v: 'RETAINER', l: 'Company retainer' },
]

export function QuickAddModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const router = useRouter()
  const [f, setF] = useState({
    firstName: '',
    lastName: '',
    gender: '',
    phone: '',
    dateOfBirth: '',
    payerType: 'CASH',
    hmoName: '',
    hmoNumber: '',
  })
  const [error, setError] = useState('')
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }))

  const key = String(open)
  const [seen, setSeen] = useState(key)
  if (key !== seen) {
    setSeen(key)
    setF({ firstName: '', lastName: '', gender: '', phone: '', dateOfBirth: '', payerType: 'CASH', hmoName: '', hmoNumber: '' })
    setError('')
  }

  const create = useMutation({
    mutationFn: () =>
      patientsApi.create({
        firstName: f.firstName.trim(),
        lastName: f.lastName.trim(),
        gender: f.gender || undefined,
        phone: f.phone || undefined,
        dateOfBirth: f.dateOfBirth || undefined,
        payerType: f.payerType,
        hmoName: f.payerType === 'HMO' ? f.hmoName || undefined : undefined,
        hmoNumber: ['HMO', 'NHIS'].includes(f.payerType) ? f.hmoNumber || undefined : undefined,
      }),
    onSuccess: (p) => {
      trackFirst('first_patient_created', { via: 'quick-add' })
      qc.invalidateQueries({ queryKey: ['patients'] })
      onClose()
      router.push(`/patients/${p.id}`)
    },
    onError: (e: any) => setError(e?.response?.data?.message ?? 'Could not create the patient.'),
  })

  return (
    <Modal open={open} onClose={onClose} title="Quick add patient" width={480} align="center">
      <p className="text-sm text-gray-500 -mt-1 mb-3">
        Creates the record and a patient number now. Complete the full profile later.
      </p>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" required>
            <Input value={f.firstName} onChange={set('firstName')} autoFocus />
          </Field>
          <Field label="Last name" required>
            <Input value={f.lastName} onChange={set('lastName')} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Gender">
            <Select value={f.gender} onChange={set('gender')}>
              <option value="">Select</option>
              <option>Male</option>
              <option>Female</option>
              <option>Other</option>
            </Select>
          </Field>
          <Field label="Date of birth">
            <Input type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} />
          </Field>
        </div>
        <Field label="Phone">
          <Input value={f.phone} onChange={set('phone')} placeholder="080..." />
        </Field>
        <Field label="Payer">
          <Select value={f.payerType} onChange={set('payerType')}>
            {PAYERS.map((p) => (
              <option key={p.v} value={p.v}>
                {p.l}
              </option>
            ))}
          </Select>
        </Field>
        {f.payerType === 'HMO' && (
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="HMO name" value={f.hmoName} onChange={set('hmoName')} />
            <Input placeholder="HMO number" value={f.hmoNumber} onChange={set('hmoNumber')} />
          </div>
        )}
        {f.payerType === 'NHIS' && (
          <Input placeholder="NHIS number" value={f.hmoNumber} onChange={set('hmoNumber')} />
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={create.isPending}
            disabled={f.firstName.trim().length < 1 || f.lastName.trim().length < 1}
            onClick={() => create.mutate()}
          >
            Create &amp; open
          </Button>
        </div>
      </div>
    </Modal>
  )
}
