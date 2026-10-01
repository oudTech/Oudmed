'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { AdmissionDTO } from '@oudhealth/contracts'
import { Drawer, Button, Badge, Field, Input, Select, Textarea } from '@/components/ui/kit'
import { useToast } from '@/components/ui/feedback'
import { dischargeAdmission, transferAdmission, getWardBoard, getAdmissionBill } from '@/lib/hospital'
import { can } from '@/lib/permissions'
import { naira } from '@/lib/billing'

const OUTCOMES = [
  { v: 'DISCHARGED', l: 'Discharged' },
  { v: 'TRANSFERRED_OUT', l: 'Transferred to another facility' },
  { v: 'DECEASED', l: 'Deceased' },
  { v: 'ABSCONDED', l: 'Absconded' },
]

function daysSince(iso: string) {
  return Math.max(1, Math.ceil((Date.now() - new Date(iso).getTime()) / 86400000))
}

export function AdmissionDrawer({
  admission,
  onClose,
}: {
  admission: AdmissionDTO | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: session } = useSession()
  const role = session?.role
  const [mode, setMode] = useState<'view' | 'discharge' | 'transfer'>('view')
  const [outcome, setOutcome] = useState('DISCHARGED')
  const [notes, setNotes] = useState('')
  const [targetBed, setTargetBed] = useState('')
  const [error, setError] = useState('')
  const [unsettled, setUnsettled] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [refundNow, setRefundNow] = useState(false)
  const [refundMethod, setRefundMethod] = useState('CASH')
  const [refundReference, setRefundReference] = useState('')

  const board = useQuery({ queryKey: ['wards'], queryFn: getWardBoard, enabled: mode === 'transfer' })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['wards'] })
    qc.invalidateQueries({ queryKey: ['admissions'] })
  }

  const discharge = useMutation({
    mutationFn: () => dischargeAdmission(admission!.id, {
      status: outcome,
      dischargeNotes: notes || undefined,
      overrideReason: unsettled ? overrideReason : undefined,
      refundMethod: refundNow ? refundMethod : undefined,
      refundReference: refundNow ? (refundReference || undefined) : undefined,
    }),
    onSuccess: async () => {
      invalidate()
      // Discharge never blocks on a balance or a refund - check afterward
      // whether either still needs attention, rather than a blocking error.
      try {
        const bill = await getAdmissionBill(admission!.id)
        if (Number(bill.balance) > 0) {
          toast(`Discharged - ${naira(bill.balance)} still owed on this admission.`, 'error')
        } else if (bill.pendingRefund) {
          toast(`Discharged - ${naira(bill.pendingRefund)} refund pending. Pay it out from the inpatient workspace.`, 'info')
        }
      } catch {
        // non-fatal - the discharge itself already succeeded
      }
      onClose()
    },
    onError: (e: any) => {
      const code = e?.response?.data?.code
      if (code === 'UNSETTLED_BALANCE') {
        setUnsettled(true)
        setError(e?.response?.data?.message ?? 'This admission needs settling before it can be discharged.')
      } else {
        setError(e?.response?.data?.message ?? 'Could not discharge.')
      }
    },
  })
  const transfer = useMutation({
    mutationFn: () => transferAdmission(admission!.id, targetBed),
    onSuccess: (updated) => {
      invalidate()
      setMode('view')
      if (!updated.ward?.dailyRate) {
        toast('Transferred - but this ward has no daily rate set, so bed charges are on hold until one is.', 'error')
      }
    },
    onError: (e: any) => setError(e?.response?.data?.message ?? 'Could not transfer.'),
  })

  if (!admission) return null

  return (
    <Drawer open={!!admission} onClose={onClose} title={`Admission ${admission.admissionNumber}`}>
      <div className="space-y-5">
        <div>
          <Badge color="#4338CA" bg="#EEF0FF">
            {admission.admissionType} · day {daysSince(admission.admittedAt)}
          </Badge>
          <h3 className="text-lg font-bold text-gray-900 mt-1">
            {admission.patient.firstName} {admission.patient.lastName}
          </h3>
          <p className="text-sm text-gray-400">{admission.patient.patientNumber}</p>
        </div>

        <dl className="text-sm divide-y divide-gray-100 border border-gray-100 rounded-xl">
          <Row label="Ward / bed">
            {admission.ward?.name ?? '-'} · {admission.bed?.label ?? '-'}
          </Row>
          <Row label="Attending">{admission.attendingDoctor?.fullName ?? '-'}</Row>
          <Row label="Admitted">{new Date(admission.admittedAt).toLocaleString('en-GB')}</Row>
          <Row label="Payer">
            {admission.payerType === 'CASH' ? 'Cash' : admission.payerType}
            {admission.hmoName ? ` · ${admission.hmoName}` : ''}
          </Row>
          {admission.reason && <Row label="Complaint">{admission.reason}</Row>}
          {admission.provisionalDiagnosis && <Row label="Diagnosis">{admission.provisionalDiagnosis}</Row>}
        </dl>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {mode === 'view' && (
          <div className="space-y-2">
            {can(role, 'patient:read') && (
              <Link href={`/admissions/${admission.id}`} className="block">
                <Button variant="secondary" className="w-full">Open inpatient workspace</Button>
              </Link>
            )}
            {can(role, 'admission:transfer') && (
              <Button variant="secondary" className="w-full" onClick={() => { setError(''); setMode('transfer') }}>
                Transfer bed
              </Button>
            )}
            {can(role, 'admission:discharge') && (
              <Button
                className="w-full"
                onClick={() => {
                  setError(''); setUnsettled(false); setOverrideReason(''); setRefundNow(false); setRefundReference('')
                  setMode('discharge')
                }}
              >
                Discharge
              </Button>
            )}
            {!can(role, 'admission:discharge') && !can(role, 'admission:transfer') && (
              <p className="text-xs text-gray-400 text-center">Your role can view but not change this admission.</p>
            )}
          </div>
        )}

        {mode === 'discharge' && (
          <div className="space-y-3 border border-gray-100 rounded-xl p-3">
            <Field label="Outcome">
              <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                {OUTCOMES.map((o) => (
                  <option key={o.v} value={o.v}>{o.l}</option>
                ))}
              </Select>
            </Field>
            <Field label="Discharge notes">
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>

            {unsettled && (
              can(role, 'admission:discharge-unsettled') ? (
                <Field label="Reason for discharging with a balance owed" required>
                  <Textarea rows={2} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="e.g. family emergency, will settle later" />
                </Field>
              ) : (
                <p className="text-xs text-amber-600">Only a Hospital Admin can discharge with a balance still owed.</p>
              )
            )}

            {can(role, 'admission:deposit-refund') && (
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={refundNow} onChange={(e) => setRefundNow(e.target.checked)} />
                  Refund any remaining deposit now
                </label>
                <p className="text-xs text-gray-400 mt-0.5">
                  Discharge never waits on this - leave unchecked and any remainder is recorded as a pending refund for billing to pay out later.
                </p>
                {refundNow && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                    <Field label="Refund method">
                      <Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
                        <option value="CASH">Cash</option>
                        <option value="CARD">Card</option>
                        <option value="TRANSFER">Transfer</option>
                      </Select>
                    </Field>
                    <Field label="Reference (optional)">
                      <Input value={refundReference} onChange={(e) => setRefundReference(e.target.value)} />
                    </Field>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setMode('view')}>Back</Button>
              <Button
                variant="danger"
                className="flex-1"
                loading={discharge.isPending}
                disabled={unsettled && (!can(role, 'admission:discharge-unsettled') || !overrideReason.trim())}
                onClick={() => discharge.mutate()}
              >
                Confirm discharge
              </Button>
            </div>
          </div>
        )}

        {mode === 'transfer' && (
          <div className="space-y-3 border border-gray-100 rounded-xl p-3">
            <Field label="Move to">
              <Select value={targetBed} onChange={(e) => setTargetBed(e.target.value)}>
                <option value="">Select an available bed</option>
                {board.data?.flatMap((w) =>
                  w.beds
                    .filter((b) => b.status === 'AVAILABLE')
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {w.name} · {b.label}
                      </option>
                    )),
                )}
              </Select>
            </Field>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setMode('view')}>Back</Button>
              <Button className="flex-1" disabled={!targetBed} loading={transfer.isPending} onClick={() => transfer.mutate()}>
                Move patient
              </Button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 px-3 py-2">
      <dt className="text-gray-400 w-24 flex-shrink-0">{label}</dt>
      <dd className="text-gray-800 font-medium">{children}</dd>
    </div>
  )
}
