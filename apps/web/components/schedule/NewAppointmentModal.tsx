'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PatientPickerValue } from '@/lib/hospital'
import { Modal, Field, Input, Select, Textarea, Button } from '@/components/ui/kit'
import { PatientPicker } from './PatientPicker'
import { getDoctors, getDepartments, bookVisit, type BookVisitInput } from '@/lib/hospital'
import { toLocalInput, fromLocalInput } from '@/lib/datetime'
import { trackFirst } from '@/lib/onboarding/analytics'

const VISIT_TYPES = [
  { v: 'CONSULTATION', l: 'New consultation' },
  { v: 'FOLLOW_UP', l: 'Follow-up' },
  { v: 'WALK_IN', l: 'Walk-in' },
  { v: 'EMERGENCY', l: 'Emergency' },
]
const DURATIONS = [15, 20, 30, 45, 60, 90]

export function NewAppointmentModal({
  open,
  onClose,
  prefill,
}: {
  open: boolean
  onClose: () => void
  prefill?: { doctorId?: string; startsAt?: Date; patient?: PatientPickerValue }
}) {
  const qc = useQueryClient()
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: getDoctors, enabled: open })
  const departments = useQuery({ queryKey: ['departments'], queryFn: getDepartments, enabled: open })

  const [patient, setPatient] = useState<PatientPickerValue | null>(prefill?.patient ?? null)
  const [doctorId, setDoctorId] = useState(prefill?.doctorId ?? '')
  const [departmentId, setDepartmentId] = useState('')
  const [startLocal, setStartLocal] = useState(
    toLocalInput(prefill?.startsAt ?? roundToNextHalfHour()),
  )
  const [duration, setDuration] = useState(30)
  const [visitType, setVisitType] = useState('CONSULTATION')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [confirmClash, setConfirmClash] = useState(false)

  // reset when reopened with new prefill
  const key = `${open}-${prefill?.doctorId}-${prefill?.startsAt?.toISOString()}-${prefill?.patient?.id ?? ''}`
  const [seenKey, setSeenKey] = useState(key)
  if (key !== seenKey) {
    setSeenKey(key)
    setPatient(prefill?.patient ?? null)
    setDoctorId(prefill?.doctorId ?? '')
    setDepartmentId('')
    setStartLocal(toLocalInput(prefill?.startsAt ?? roundToNextHalfHour()))
    setDuration(30)
    setVisitType('CONSULTATION')
    setReason('')
    setError('')
    setConfirmClash(false)
  }

  const book = useMutation({
    mutationFn: (force: boolean) => {
      const payload: BookVisitInput = {
        patientId: patient!.id,
        doctorId: doctorId || undefined,
        departmentId: departmentId || undefined,
        startsAt: fromLocalInput(startLocal),
        durationMinutes: duration,
        visitType,
        reason: reason.trim() || undefined,
        force,
      }
      return bookVisit(payload)
    },
    onSuccess: () => {
      trackFirst('first_appointment_created')
      qc.invalidateQueries({ queryKey: ['schedule'] })
      onClose()
    },
    onError: (e: any) => {
      const code = e?.response?.data?.code
      if (code === 'DOCTOR_DOUBLE_BOOKED') {
        setConfirmClash(true)
        setError('That doctor already has an appointment in this slot.')
      } else if (code === 'OUTSIDE_WORKING_HOURS') {
        setConfirmClash(true)
        setError("That time is outside the doctor's working hours.")
      } else {
        setError(e?.response?.data?.message ?? 'Could not book the appointment.')
      }
    },
  })

  const canSubmit = !!patient && !!startLocal

  return (
    <Modal open={open} onClose={onClose} title="New appointment" width={600}>
      <div className="space-y-4">
        <PatientPicker value={patient} onChange={setPatient} />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Doctor">
            <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">Any / unassigned</option>
              {doctors.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                  {d.jobTitle ? ` - ${d.jobTitle}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Department">
            <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">Not set</option>
              {departments.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Starts" required>
            <Input
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
            />
          </Field>
          <Field label="Duration">
            <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={visitType} onChange={(e) => setVisitType(e.target.value)}>
              {VISIT_TYPES.map((v) => (
                <option key={v.v} value={v.v}>
                  {v.l}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Reason for visit">
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Chief complaint or note for the doctor"
          />
        </Field>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {confirmClash ? (
            <Button
              variant="danger"
              loading={book.isPending}
              onClick={() => book.mutate(true)}
            >
              Book anyway
            </Button>
          ) : (
            <Button
              loading={book.isPending}
              disabled={!canSubmit}
              onClick={() => book.mutate(false)}
            >
              Book appointment
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function roundToNextHalfHour(): Date {
  const d = new Date()
  d.setMinutes(d.getMinutes() > 30 ? 60 : 30, 0, 0)
  return d
}
