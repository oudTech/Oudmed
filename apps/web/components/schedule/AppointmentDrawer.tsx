'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { VisitDTO, VisitStatus } from '@oudhealth/contracts'
import { Drawer, Button, Badge, Field, Input, Select } from '@/components/ui/kit'
import { useConfirm } from '@/components/ui/feedback'
import {
  setVisitStatus,
  rescheduleVisit,
  nextActions,
  VISIT_STATUS_META,
  VISIT_TYPE_LABEL,
} from '@/lib/hospital'
import { can, STATUS_ACTION } from '@/lib/permissions'
import { toLocalInput, fromLocalInput, timeLabel } from '@/lib/datetime'

export function AppointmentDrawer({
  visit,
  onClose,
  onAdmit,
}: {
  visit: VisitDTO | null
  onClose: () => void
  onAdmit: (v: VisitDTO) => void
}) {
  const qc = useQueryClient()
  const router = useRouter()
  const confirm = useConfirm()
  const { data: session } = useSession()
  const role = session?.role
  const [rescheduling, setRescheduling] = useState(false)
  const [startLocal, setStartLocal] = useState('')
  const [duration, setDuration] = useState(30)
  const [error, setError] = useState('')

  const invalidate = () => qc.invalidateQueries({ queryKey: ['schedule'] })

  const status = useMutation({
    mutationFn: (s: VisitStatus) => setVisitStatus(visit!.id, s),
    onSuccess: (_data, s) => {
      invalidate()
      if (s === 'IN_PROGRESS') router.push(`/encounters/${visit!.id}`)
    },
    onError: (e: any) => setError(e?.response?.data?.message ?? 'Could not update status.'),
  })

  const reschedule = useMutation({
    mutationFn: (force: boolean) =>
      rescheduleVisit(visit!.id, {
        startsAt: fromLocalInput(startLocal),
        durationMinutes: duration,
        force,
      }),
    onSuccess: () => {
      invalidate()
      setRescheduling(false)
    },
    onError: (e: any) => setError(e?.response?.data?.message ?? 'Could not reschedule.'),
  })

  if (!visit) return null
  const meta = VISIT_STATUS_META[visit.status]
  const mins = Math.round(
    (new Date(visit.endsAt).getTime() - new Date(visit.startsAt).getTime()) / 60000,
  )

  return (
    <Drawer open={!!visit} onClose={onClose} title="Appointment">
      <div className="space-y-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge color={meta.text} bg={meta.bg}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.dot }} />
              {meta.label}
            </Badge>
            <span className="text-xs text-gray-400">{VISIT_TYPE_LABEL[visit.visitType]}</span>
          </div>
          <h3 className="text-lg font-bold text-gray-900">
            {visit.patient.firstName} {visit.patient.lastName}
          </h3>
          <p className="text-sm text-gray-400">
            {visit.patient.patientNumber} · {visit.patient.phone ?? 'no phone'}
          </p>
        </div>

        <dl className="text-sm divide-y divide-gray-100 border border-gray-100 rounded-xl">
          <Row label="Time">
            {timeLabel(visit.startsAt)} - {timeLabel(visit.endsAt)} ({mins} min)
          </Row>
          <Row label="Doctor">{visit.doctor?.fullName ?? 'Unassigned'}</Row>
          <Row label="Department">{visit.department?.name ?? '-'}</Row>
          <Row label="Payer">
            {visit.payerType === 'CASH' ? 'Cash' : visit.payerType}
            {visit.hmoName ? ` · ${visit.hmoName}` : ''}
          </Row>
          {visit.reason && <Row label="Reason">{visit.reason}</Row>}
          {visit.notes && <Row label="Notes">{visit.notes}</Row>}
        </dl>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {!rescheduling ? (
          <div className="space-y-2">
            {['CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'].includes(visit.status) && (
              <Button
                variant={visit.status === 'IN_PROGRESS' ? 'primary' : 'secondary'}
                className="w-full"
                onClick={() => router.push(`/encounters/${visit.id}`)}
              >
                {visit.status === 'COMPLETED' ? 'View encounter' : 'Open encounter'}
              </Button>
            )}
            {nextActions(visit.status)
              .filter((a) => can(role, STATUS_ACTION[a.status]))
              .map((a) => {
                const halts = a.status === 'CANCELLED' || a.status === 'NO_SHOW'
                return (
                  <Button
                    key={a.status}
                    variant={halts ? 'secondary' : 'primary'}
                    className="w-full"
                    loading={status.isPending}
                    onClick={async () => {
                      if (halts) {
                        const ok = await confirm({
                          title: `${a.label}?`,
                          body: `${visit.patient.firstName} ${visit.patient.lastName}'s appointment will be marked ${a.label.toLowerCase()}. This can be undone from here later if needed.`,
                          confirmLabel: a.label,
                          danger: true,
                        })
                        if (!ok) return
                      }
                      status.mutate(a.status)
                    }}
                  >
                    {a.label}
                  </Button>
                )
              })}
            {visit.status !== 'COMPLETED' &&
              visit.status !== 'CANCELLED' &&
              can(role, 'appointment:reschedule') && (
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    setStartLocal(toLocalInput(new Date(visit.startsAt)))
                    setDuration(mins)
                    setRescheduling(true)
                  }}
                >
                  Reschedule
                </Button>
              )}
            {can(role, 'admission:create') && (
              <Button variant="ghost" className="w-full" onClick={() => onAdmit(visit)}>
                Admit this patient
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3 border border-gray-100 rounded-xl p-3">
            <Field label="New start">
              <Input
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
              />
            </Field>
            <Field label="Duration">
              <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {[15, 20, 30, 45, 60, 90].map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setRescheduling(false)}>
                Back
              </Button>
              <Button
                className="flex-1"
                loading={reschedule.isPending}
                onClick={() => reschedule.mutate(false)}
              >
                Save
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
