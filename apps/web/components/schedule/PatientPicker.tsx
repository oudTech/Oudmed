'use client'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Field, Input, Select, Button } from '@/components/ui/kit'
import { searchPatients, createPatient, type PatientPickerValue } from '@/lib/hospital'

const PAYERS = [
  { v: 'CASH', l: 'Cash / self-pay' },
  { v: 'HMO', l: 'HMO' },
  { v: 'NHIS', l: 'NHIS' },
  { v: 'RETAINER', l: 'Company retainer' },
]

export function PatientPicker({
  value,
  onChange,
}: {
  value: PatientPickerValue | null
  onChange: (p: PatientPickerValue | null) => void
}) {
  const [term, setTerm] = useState('')
  const [registering, setRegistering] = useState(false)
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    gender: '',
    payerType: 'CASH',
    hmoName: '',
    hmoNumber: '',
  })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }))

  const results = useQuery({
    queryKey: ['patient-search', term],
    queryFn: () => searchPatients(term),
    enabled: term.trim().length >= 2 && !value,
  })

  const [regError, setRegError] = useState('')
  const register = useMutation({
    mutationFn: () =>
      createPatient({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: form.phone || undefined,
        gender: form.gender || undefined,
        payerType: form.payerType,
        hmoName: form.payerType === 'HMO' ? form.hmoName || undefined : undefined,
        hmoNumber: ['HMO', 'NHIS'].includes(form.payerType) ? form.hmoNumber || undefined : undefined,
      }),
    onSuccess: (p) => {
      onChange(p)
      setRegistering(false)
    },
    onError: (e: any) => {
      const m = e?.response?.data?.message
      setRegError(
        e?.response?.status === 403
          ? 'Your role cannot register patients.'
          : (Array.isArray(m) ? m[0] : m) || 'Could not register the patient.',
      )
    },
  })

  if (value) {
    return (
      <Field label="Patient" required>
        <div className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {value.firstName} {value.lastName}
            </p>
            <p className="text-xs text-gray-400">
              {value.patientNumber} · {value.phone ?? 'no phone'} ·{' '}
              {value.payerType === 'CASH' ? 'Cash' : value.payerType}
              {value.hmoName ? ` (${value.hmoName})` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-[#0A89D3] hover:underline flex-shrink-0 ml-2"
          >
            Change
          </button>
        </div>
      </Field>
    )
  }

  return (
    <Field label="Patient" required>
      {!registering ? (
        <>
          <div className="relative">
            <Input
              placeholder="Search name, patient number or HMO number"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              autoFocus
            />
          </div>
          {term.trim().length >= 2 && (
            <div className="mt-1 border border-gray-100 rounded-lg divide-y max-h-52 overflow-y-auto">
              {results.isLoading && <p className="p-3 text-xs text-gray-400">Searching…</p>}
              {results.data?.length === 0 && !results.isLoading && (
                <p className="p-3 text-xs text-gray-400">No match.</p>
              )}
              {results.data?.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => onChange(p)}
                  className="w-full text-left px-3 py-2 hover:bg-blue-50/50"
                >
                  <span className="text-sm font-medium text-gray-900">
                    {p.firstName} {p.lastName}
                  </span>
                  <span className="text-xs text-gray-400 ml-2">
                    {p.patientNumber} · {p.phone ?? '-'}
                  </span>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setRegistering(true)}
            className="mt-2 text-sm text-[#0A89D3] hover:underline font-medium"
          >
            + Register a new patient
          </button>
        </>
      ) : (
        <div className="border border-gray-100 rounded-lg p-3 space-y-3 bg-gray-50/50">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="First name" value={form.firstName} onChange={set('firstName')} autoFocus />
            <Input placeholder="Last name" value={form.lastName} onChange={set('lastName')} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Phone" value={form.phone} onChange={set('phone')} />
            <Select value={form.gender} onChange={set('gender')}>
              <option value="">Gender</option>
              <option>Male</option>
              <option>Female</option>
              <option>Other</option>
            </Select>
          </div>
          <Select value={form.payerType} onChange={set('payerType')}>
            {PAYERS.map((p) => (
              <option key={p.v} value={p.v}>
                {p.l}
              </option>
            ))}
          </Select>
          {form.payerType === 'HMO' && (
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="HMO name" value={form.hmoName} onChange={set('hmoName')} />
              <Input placeholder="HMO / policy number" value={form.hmoNumber} onChange={set('hmoNumber')} />
            </div>
          )}
          {form.payerType === 'NHIS' && (
            <Input placeholder="NHIS number" value={form.hmoNumber} onChange={set('hmoNumber')} />
          )}
          {regError && <p className="text-xs text-red-500">{regError}</p>}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setRegError('')
                setRegistering(false)
              }}
              className="flex-1"
            >
              Back to search
            </Button>
            <Button
              type="button"
              onClick={() => {
                setRegError('')
                register.mutate()
              }}
              loading={register.isPending}
              disabled={form.firstName.trim().length < 1 || form.lastName.trim().length < 1}
              className="flex-1"
            >
              Register
            </Button>
          </div>
        </div>
      )}
    </Field>
  )
}
