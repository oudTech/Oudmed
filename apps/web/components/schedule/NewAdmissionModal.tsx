'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PatientPickerValue } from '@/lib/hospital'
import { Modal, Field, Input, Select, Textarea, Button } from '@/components/ui/kit'
import { PatientPicker } from './PatientPicker'
import {
  getDoctors,
  getDepartments,
  getWards,
  getBeds,
  admitPatient,
  type AdmitInput,
} from '@/lib/hospital'

const ADMISSION_TYPES = [
  { v: 'EMERGENCY', l: 'Emergency' },
  { v: 'ELECTIVE', l: 'Elective' },
  { v: 'TRANSFER', l: 'Transfer in' },
  { v: 'REFERRAL', l: 'Referral' },
  { v: 'OBSERVATION', l: 'Observation' },
]

export function NewAdmissionModal({
  open,
  onClose,
  prefill,
}: {
  open: boolean
  onClose: () => void
  prefill?: { wardId?: string; bedId?: string }
}) {
  const qc = useQueryClient()
  const doctors = useQuery({ queryKey: ['doctors'], queryFn: getDoctors, enabled: open })
  const departments = useQuery({ queryKey: ['departments'], queryFn: getDepartments, enabled: open })
  const wards = useQuery({ queryKey: ['wards-list'], queryFn: getWards, enabled: open })

  const [patient, setPatient] = useState<PatientPickerValue | null>(null)
  const [admittingDoctorId, setAdmittingDoctorId] = useState('')
  const [attendingDoctorId, setAttendingDoctorId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [wardId, setWardId] = useState(prefill?.wardId ?? '')
  const [bedId, setBedId] = useState(prefill?.bedId ?? '')
  const [admissionType, setAdmissionType] = useState('EMERGENCY')
  const [reason, setReason] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [error, setError] = useState('')

  const beds = useQuery({
    queryKey: ['beds', wardId],
    queryFn: () => getBeds(wardId, 'AVAILABLE'),
    enabled: open && !!wardId,
  })

  const key = `${open}-${prefill?.bedId ?? ''}`
  const [seen, setSeen] = useState(key)
  if (key !== seen) {
    setSeen(key)
    setPatient(null)
    setAdmittingDoctorId('')
    setAttendingDoctorId('')
    setDepartmentId('')
    setWardId(prefill?.wardId ?? '')
    setBedId(prefill?.bedId ?? '')
    setAdmissionType('EMERGENCY')
    setReason('')
    setDiagnosis('')
    setError('')
  }

  const admit = useMutation({
    mutationFn: () => {
      const payload: AdmitInput = {
        patientId: patient!.id,
        admittingDoctorId: admittingDoctorId || undefined,
        attendingDoctorId: attendingDoctorId || admittingDoctorId || undefined,
        departmentId: departmentId || undefined,
        wardId,
        bedId,
        admissionType,
        reason: reason.trim() || undefined,
        provisionalDiagnosis: diagnosis.trim() || undefined,
      }
      return admitPatient(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admissions'] })
      qc.invalidateQueries({ queryKey: ['wards'] })
      onClose()
    },
    onError: (e: any) => setError(e?.response?.data?.message ?? 'Could not admit the patient.'),
  })

  const canSubmit = !!patient && !!wardId && !!bedId && !!admissionType

  return (
    <Modal open={open} onClose={onClose} title="New admission" width={620}>
      <div className="space-y-4">
        <PatientPicker value={patient} onChange={setPatient} />

        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-1">
          Admission information
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Admitting doctor">
            <Select value={admittingDoctorId} onChange={(e) => setAdmittingDoctorId(e.target.value)}>
              <option value="">Not set</option>
              {doctors.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Attending doctor">
            <Select value={attendingDoctorId} onChange={(e) => setAttendingDoctorId(e.target.value)}>
              <option value="">Same as admitting</option>
              {doctors.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
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
          <Field label="Admission type" required>
            <Select value={admissionType} onChange={(e) => setAdmissionType(e.target.value)}>
              {ADMISSION_TYPES.map((a) => (
                <option key={a.v} value={a.v}>
                  {a.l}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Ward" required>
            <Select
              value={wardId}
              onChange={(e) => {
                setWardId(e.target.value)
                setBedId('')
              }}
            >
              <option value="">Select ward</option>
              {wards.data?.map((w) => (
                <option key={w.id} value={w.id} disabled={w.availableBeds === 0}>
                  {w.name} ({w.availableBeds}/{w.bedCount} free)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Bed" required>
            <Select
              value={bedId}
              onChange={(e) => setBedId(e.target.value)}
              disabled={!wardId}
            >
              <option value="">{wardId ? 'Select bed' : 'Choose a ward first'}</option>
              {beds.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Presenting complaint">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Severe abdominal pain" />
        </Field>
        <Field label="Provisional diagnosis">
          <Textarea
            rows={2}
            value={diagnosis}
            onChange={(e) => setDiagnosis(e.target.value)}
            placeholder="Working diagnosis / plan"
          />
        </Field>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={admit.isPending} disabled={!canSubmit} onClick={() => admit.mutate()}>
            Admit patient
          </Button>
        </div>
      </div>
    </Modal>
  )
}
