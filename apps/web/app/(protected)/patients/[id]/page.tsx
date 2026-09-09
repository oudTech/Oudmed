'use client'
import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { ComplaintDTO, PatientDTO } from '@oudhealth/contracts'
import { Button, Textarea } from '@/components/ui/kit'
import {
  patientsApi,
  patientName,
  PATIENT_STATUS_META,
  PRESCRIPTION_STATUS_META,
  INVOICE_STATUS_META,
  titleCase,
  vitalFlag,
} from '@/lib/patients'
import { can } from '@/lib/permissions'
import { useToast, useConfirm } from '@/components/ui/feedback'
import { NewAppointmentModal } from '@/components/schedule/NewAppointmentModal'
import {
  AddDiagnosisModal,
  AddVitalsModal,
  AddPrescriptionModal,
  AddDocumentModal,
  ComplaintDetailModal,
} from '@/components/patients/clinicalModals'
import { RecordPaymentModal } from '@/components/billing/RecordPaymentModal'
import { InvoiceDetailDrawer } from '@/components/billing/InvoiceDetailDrawer'
import { VISIT_STATUS_META } from '@/lib/hospital'
import { ORDER_STATUS_META, ORDER_TYPE_LABEL, DISPENSE_STATUS_META } from '@/lib/encounters'
import { timeLabel } from '@/lib/datetime'

const TABS = [
  'Overview',
  'Appointments',
  'Complaints',
  'Diagnoses',
  'Investigations',
  'Medical background',
  'Vital Signs',
  'Prescriptions',
  'Documents',
  'Invoices',
] as const
type Tab = (typeof TABS)[number]

const naira = (v: string) => '₦' + Number(v).toLocaleString()
const d = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB') : '-')

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: session } = useSession()
  const [tab, setTab] = useState<Tab>('Overview')
  const [schedule, setSchedule] = useState(false)

  const allowed = can(session?.role, 'patient:read')
  const patient = useQuery({
    queryKey: ['patient', id],
    queryFn: () => patientsApi.get(id),
    enabled: allowed,
  })
  const p = patient.data

  if (!allowed) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Patient record</h1>
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6">
          Patient records are available to clinical and front-desk staff.
        </p>
      </div>
    )
  }

  if (!p) {
    return <div className="p-8 text-sm text-gray-400">Loading…</div>
  }

  const meta = PATIENT_STATUS_META[p.status]

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* header */}
      <div className="px-8 py-4 flex items-center justify-between flex-shrink-0 border-b border-[#D6DEE8]">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Link href="/patients" className="hover:text-gray-700">
            Patients
          </Link>
          <span>/</span>
          <span className="text-gray-900 font-medium">{patientName(p)}</span>
        </div>
        {can(session?.role, 'appointment:book') && (
          <Button onClick={() => setSchedule(true)}>Schedule appointment</Button>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* left rail */}
        <div className="w-56 flex-shrink-0 border-r border-gray-100 p-3 overflow-y-auto">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm mb-1 transition ${
                tab === t ? 'bg-blue-50 text-primary font-semibold' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* content */}
        <div className="flex-1 overflow-y-auto p-8">
          {/* person header */}
          <div className="flex items-start gap-4 mb-6">
            <PatientPhoto p={p} canEdit={can(session?.role, 'patient:edit')} />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900">{patientName(p)}</h1>
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ color: meta.color, backgroundColor: meta.bg }}
                >
                  {meta.label}
                </span>
              </div>
              <p className="text-sm text-gray-400 mt-0.5">
                {p.phone ?? 'no phone'} &nbsp;·&nbsp; {p.patientNumber} &nbsp;·&nbsp; Last visit{' '}
                {d(p.lastVisitAt)}
              </p>
            </div>
          </div>

          {p.registrationStatus === 'INCOMPLETE' && (
            <div className="mb-6 flex items-center justify-between bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <p className="text-sm text-amber-800">
                This patient&apos;s registration is incomplete (step {p.registrationStep} of 8).
              </p>
              <Link
                href={`/patients/new?id=${p.id}`}
                className="text-sm font-semibold text-[#B45309] hover:underline"
              >
                Complete registration
              </Link>
            </div>
          )}

          {tab === 'Overview' && <Overview p={p} />}
          {tab === 'Appointments' && <Appointments id={id} />}
          {tab === 'Complaints' && <Complaints id={id} role={session?.role} />}
          {tab === 'Diagnoses' && <Diagnoses id={id} role={session?.role} />}
          {tab === 'Investigations' && <Investigations id={id} />}
          {tab === 'Medical background' && <MedicalBackground p={p} role={session?.role} />}
          {tab === 'Vital Signs' && <Vitals id={id} role={session?.role} />}
          {tab === 'Prescriptions' && <Prescriptions id={id} role={session?.role} />}
          {tab === 'Documents' && <Documents id={id} role={session?.role} />}
          {tab === 'Invoices' && <Invoices id={id} role={session?.role} patientName={patientName(p)} />}
        </div>
      </div>

      <NewAppointmentModal
        open={schedule}
        onClose={() => setSchedule(false)}
        prefill={{
          patient: {
            id: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            patientNumber: p.patientNumber,
            phone: p.phone,
            payerType: p.payerType,
            hmoName: p.hmoName,
          },
        }}
      />
    </div>
  )
}

/* ── section helpers ── */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-100 rounded-xl p-5 mb-4">
      <h3 className="font-bold text-gray-900 mb-3">{title}</h3>
      {children}
    </div>
  )
}
function Group({ label, rows }: { label: string; rows: [string, React.ReactNode][] }) {
  return (
    <div className="mb-5 last:mb-0">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      <dl className="text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-4 py-1">
            <dt className="text-gray-400 w-40 flex-shrink-0">{k}</dt>
            <dd className="text-gray-800 font-medium">{v || '-'}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="font-bold text-gray-900">{title}</h3>
      {action}
    </div>
  )
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl p-6 text-center">{children}</p>
}

/* ── tabs ── */
function Overview({ p }: { p: PatientDTO }) {
  return (
    <Card title="Basic information">
      <Group
        label="Personal info"
        rows={[
          ['Full name', patientName(p)],
          ['Age', p.age != null ? `${p.age} years` : '-'],
          ['Gender', p.gender],
          ['Marital status', titleCase(p.maritalStatus)],
          ['Occupation', p.occupation],
          ['Nationality', p.nationality],
        ]}
      />
      <Group
        label="Medical status"
        rows={[
          ['Status', p.status === 'INPATIENT' ? 'Inpatient' : 'Outpatient'],
          ['Payer', p.payerType === 'CASH' ? 'Cash' : `${p.payerType}${p.hmoName ? ` · ${p.hmoName}` : ''}`],
          ['Blood group', p.bloodGroup ? `${p.bloodGroup}${p.rhFactor ? ` ${p.rhFactor === 'POSITIVE' ? '+' : '-'}` : ''}` : '-'],
          ['Genotype', p.genotype],
          ['Assigned doctor', p.assignedDoctor?.fullName],
        ]}
      />
      <Group
        label="Body measurements"
        rows={[
          ['Weight', p.weightKg ? `${p.weightKg} kg` : '-'],
          ['Height', p.heightCm ? `${p.heightCm} cm` : '-'],
        ]}
      />
      <Group
        label="Contact info"
        rows={[
          ['Phone', p.phone],
          ['Email', p.email],
          ['Address', [p.address, p.city, p.state].filter(Boolean).join(', ')],
          ['Next of kin', p.emergencyContactName ? `${p.emergencyContactName}${p.emergencyContactRelationship ? ` (${p.emergencyContactRelationship})` : ''}` : '-'],
          ['Next of kin phone', p.emergencyContactPhone],
        ]}
      />
      {p.currentAdmission && (
        <div className="mt-2 bg-blue-50/60 border border-blue-100 rounded-lg px-4 py-3 text-sm">
          <span className="font-semibold text-blue-900">Currently admitted</span> ·{' '}
          {p.currentAdmission.admissionNumber} · {p.currentAdmission.ward} {p.currentAdmission.bed} ·
          since {d(p.currentAdmission.admittedAt)}
        </div>
      )}
    </Card>
  )
}

const NARRATIVE_FIELDS: [keyof PatientDTO, string][] = [
  ['historyPresentingComplaint', 'History of presenting complaint'],
  ['pastMedicalHistory', 'Past medical / surgical history'],
  ['drugHistory', 'Drug history'],
  ['reproductiveHistory', 'Reproductive / genitourinary history'],
  ['socialHistory', 'Social history'],
]

function MedicalBackground({ p, role }: { p: PatientDTO; role?: string }) {
  const qc = useQueryClient()
  const editable = can(role, 'patient:edit')
  const [form, setForm] = useState<Record<string, string>>({})
  useEffect(() => {
    setForm(
      Object.fromEntries(NARRATIVE_FIELDS.map(([k]) => [k, (p[k] as string | null) ?? ''])),
    )
    // Reset the editor only when switching patients, not on every background refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id])

  const dirty = NARRATIVE_FIELDS.some(([k]) => (form[k] ?? '') !== ((p[k] as string | null) ?? ''))
  const m = useMutation({
    mutationFn: () =>
      patientsApi.update(
        p.id,
        Object.fromEntries(NARRATIVE_FIELDS.map(([k]) => [k, form[k]?.trim() ?? ''])),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patient', p.id] }),
  })

  return (
    <div className="space-y-4">
      <Card title="Blood work &amp; type">
        <Group
          label="Summary"
          rows={[
            ['Blood group', p.bloodGroup ? `${p.bloodGroup}${p.rhFactor ? (p.rhFactor === 'POSITIVE' ? ' +' : ' -') : ''}` : '-'],
            ['Genotype', p.genotype ?? '-'],
            ['Pregnancy status', titleCase(p.pregnancyStatus)],
            ['Known allergies', p.allergies || 'None recorded'],
            ['Existing conditions', p.chronicConditions || 'None recorded'],
            ['Family history', p.familyHistory || 'None recorded'],
          ]}
        />
      </Card>

      <div className="border border-gray-100 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-900">Clinical history</h3>
          {editable && (
            <Button loading={m.isPending} disabled={!dirty} onClick={() => m.mutate()}>
              Save changes
            </Button>
          )}
        </div>
        <div className="space-y-4">
          {NARRATIVE_FIELDS.map(([k, label]) => (
            <div key={k}>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 block">{label}</label>
              {editable ? (
                <Textarea
                  rows={3}
                  value={form[k] ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                  placeholder="Not recorded"
                />
              ) : (
                <p className="text-sm text-gray-800 whitespace-pre-wrap">
                  {(p[k] as string | null) || <span className="text-gray-400">Not recorded</span>}
                </p>
              )}
            </div>
          ))}
        </div>
        {m.isError && <p className="text-sm text-red-600 mt-3">Could not save changes.</p>}
        {m.isSuccess && !dirty && <p className="text-sm text-green-600 mt-3">Saved.</p>}
      </div>
    </div>
  )
}

function TableShell({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="border border-gray-100 rounded-xl overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="text-left font-medium px-3 py-2.5">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Appointments({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['pt-appointments', id], queryFn: () => patientsApi.appointments(id) })
  if (!q.data) return <Empty>Loading…</Empty>
  if (!q.data.length) return <Empty>No visits recorded.</Empty>
  return (
    <>
      <SectionHead title="Visit history" />
      <TableShell head={['Date', 'Visit type', 'Doctor', 'Department', 'Diagnosis', 'Chart', 'Status', 'Invoice']}>
        {q.data.map((v) => {
          const m = VISIT_STATUS_META[v.status as keyof typeof VISIT_STATUS_META]
          return (
            <tr key={v.id} className="border-t border-gray-100 hover:bg-gray-50">
              <td className="px-3 py-2.5 text-gray-500">
                <Link href={`/encounters/${v.id}`} className="hover:underline">
                  {d(v.startsAt)} · {timeLabel(v.startsAt)}
                </Link>
              </td>
              <td className="px-3 py-2.5">{titleCase(v.visitType)}</td>
              <td className="px-3 py-2.5">{v.doctor?.fullName ?? 'Unassigned'}</td>
              <td className="px-3 py-2.5 text-gray-500">{v.department?.name ?? '-'}</td>
              <td className="px-3 py-2.5">{v.primaryDiagnosis ?? '-'}</td>
              <td className="px-3 py-2.5 text-gray-500 text-xs">
                {[v.hasNote ? 'Note' : null, v.orderCount ? `${v.orderCount} order${v.orderCount === 1 ? '' : 's'}` : null]
                  .filter(Boolean)
                  .join(' · ') || '-'}
              </td>
              <td className="px-3 py-2.5">
                <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: m.text, backgroundColor: m.bg }}>
                  {m.label}
                </span>
              </td>
              <td className="px-3 py-2.5">
                {v.invoice ? (
                  <span className="font-mono text-xs text-gray-600">{v.invoice.invoiceNumber}</span>
                ) : (
                  '-'
                )}
              </td>
            </tr>
          )
        })}
      </TableShell>
    </>
  )
}

function Investigations({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['pt-orders', id], queryFn: () => patientsApi.orders(id) })
  if (!q.data) return <Empty>Loading…</Empty>
  if (!q.data.length) return <Empty>No investigations ordered.</Empty>
  return (
    <>
      <SectionHead title="Investigations" />
      <TableShell head={['Date', 'Type', 'Test', 'Ordered by', 'Status', 'Result', 'Flag']}>
        {q.data.map((o) => {
          const om = ORDER_STATUS_META[o.status]
          return (
            <tr key={o.id} className="border-t border-gray-100">
              <td className="px-3 py-2.5 text-gray-500">{d(o.orderedAt)}</td>
              <td className="px-3 py-2.5">{ORDER_TYPE_LABEL[o.orderType] ?? o.orderType}</td>
              <td className="px-3 py-2.5">{o.name}</td>
              <td className="px-3 py-2.5">{o.orderedByName ?? '-'}</td>
              <td className="px-3 py-2.5">
                <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: om.color, backgroundColor: om.bg }}>
                  {om.label}
                </span>
              </td>
              <td className="px-3 py-2.5">
                {o.resultValue ? `${o.resultValue}${o.resultUnit ? ` ${o.resultUnit}` : ''}` : '-'}
                {o.referenceRange && <span className="text-gray-400 text-xs"> (ref {o.referenceRange})</span>}
              </td>
              <td className={`px-3 py-2.5 ${o.abnormalFlag && o.abnormalFlag !== 'Normal' ? 'text-red-600 font-semibold' : ''}`}>
                {o.abnormalFlag ?? '-'}
              </td>
            </tr>
          )
        })}
      </TableShell>
    </>
  )
}

function Complaints({ id, role }: { id: string; role?: string }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [onset, setOnset] = useState('')
  const [severity, setSeverity] = useState('')
  const [selected, setSelected] = useState<ComplaintDTO | null>(null)
  const q = useQuery({ queryKey: ['complaints', id], queryFn: () => patientsApi.complaints(id) })
  const canRecord = can(role, 'complaint:record')

  const m = useMutation({
    mutationFn: () =>
      patientsApi.addComplaint(id, {
        description: text.trim(),
        onsetNote: onset || undefined,
        severity: severity || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['complaints', id] })
      qc.invalidateQueries({ queryKey: ['patient', id] })
      setText(''); setOnset(''); setSeverity('')
    },
  })

  return (
    <>
      <SectionHead title="Complaint history" />
      {canRecord && (
        <div className="border border-gray-100 rounded-xl p-4 mb-4">
          <Textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a complaint the patient is presenting with"
          />
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <input
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-40"
              value={onset}
              onChange={(e) => setOnset(e.target.value)}
              placeholder="Onset e.g. 3 days ago"
            />
            <select
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <option value="">Severity</option>
              <option>Mild</option>
              <option>Moderate</option>
              <option>Severe</option>
            </select>
            <div className="ml-auto">
              <Button loading={m.isPending} disabled={text.trim().length < 2} onClick={() => m.mutate()}>
                Add complaint
              </Button>
            </div>
          </div>
          {m.isError && <p className="text-sm text-red-600 mt-2">Could not save.</p>}
        </div>
      )}

      {!q.data?.length ? (
        <Empty>No complaints recorded.</Empty>
      ) : (
        <TableShell head={['Date', 'Recorded by', 'Complaint', 'Severity', 'Status']}>
          {q.data.map((c) => (
            <tr
              key={c.id}
              className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
              onClick={() => setSelected(c)}
            >
              <td className="px-3 py-2.5 text-gray-500">{d(c.recordedAt)}</td>
              <td className="px-3 py-2.5">{c.recordedByName ?? '-'}</td>
              <td className="px-3 py-2.5 max-w-sm truncate">{c.description}</td>
              <td className="px-3 py-2.5">{c.severity ?? '-'}</td>
              <td className="px-3 py-2.5">
                <span className={`text-xs rounded-full px-2 py-0.5 ${c.status === 'OPEN' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                  {titleCase(c.status)}
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      <ComplaintDetailModal
        patientId={id}
        complaint={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        canEdit={canRecord}
      />
    </>
  )
}

function Diagnoses({ id, role }: { id: string; role?: string }) {
  const [add, setAdd] = useState(false)
  const q = useQuery({ queryKey: ['diagnoses', id], queryFn: () => patientsApi.diagnoses(id) })
  return (
    <>
      <SectionHead
        title="Diagnoses"
        action={can(role, 'diagnosis:record') && <Button variant="secondary" onClick={() => setAdd(true)}>Add diagnosis</Button>}
      />
      {!q.data?.length ? (
        <Empty>No diagnoses recorded.</Empty>
      ) : (
        <TableShell head={['Date', 'Attendance', 'Recorded by', 'Type', 'Diagnosis', 'Comments']}>
          {q.data.map((dx) => (
            <tr key={dx.id} className="border-t border-gray-100">
              <td className="px-3 py-2.5 text-gray-500">{d(dx.diagnosedAt)}</td>
              <td className="px-3 py-2.5">{dx.attendanceType ?? '-'}</td>
              <td className="px-3 py-2.5">{dx.recordedByName ?? '-'}</td>
              <td className="px-3 py-2.5">{titleCase(dx.certainty)}</td>
              <td className="px-3 py-2.5">
                {dx.description}
                {dx.code && <span className="ml-1 text-xs text-gray-400 font-mono">{dx.code}</span>}
              </td>
              <td className="px-3 py-2.5 max-w-xs truncate text-gray-500">{dx.notes ?? '-'}</td>
            </tr>
          ))}
        </TableShell>
      )}
      <AddDiagnosisModal patientId={id} open={add} onClose={() => setAdd(false)} />
    </>
  )
}

function Vitals({ id, role }: { id: string; role?: string }) {
  const [add, setAdd] = useState(false)
  const q = useQuery({ queryKey: ['vitals', id], queryFn: () => patientsApi.vitals(id) })
  return (
    <>
      <SectionHead
        title="Vital signs"
        action={can(role, 'vitals:record') && <Button variant="secondary" onClick={() => setAdd(true)}>Record vitals</Button>}
      />
      {!q.data?.length ? (
        <Empty>No vital signs recorded.</Empty>
      ) : (
        <TableShell
          head={['Date', 'Recorded by', 'Weight', 'BP', 'HR', 'Temp', 'RR', 'Urine OP', 'BS(R)', 'SpO₂', 'AVPU', 'Comments']}
        >
          {q.data.map((v) => (
            <tr key={v.id} className="border-t border-gray-100">
              <td className="px-3 py-2.5 text-gray-500">{d(v.recordedAt)}</td>
              <td className="px-3 py-2.5">{v.recordedByName ?? '-'}</td>
              <td className="px-3 py-2.5">{v.weightKg ? `${v.weightKg} kg` : '-'}</td>
              <Vital flag={vitalFlag('systolicBp', v.systolicBp) ?? vitalFlag('diastolicBp', v.diastolicBp)}>
                {v.systolicBp && v.diastolicBp ? `${v.systolicBp}/${v.diastolicBp}` : '-'}
              </Vital>
              <Vital flag={vitalFlag('pulseBpm', v.pulseBpm)}>{v.pulseBpm ?? '-'}</Vital>
              <Vital flag={vitalFlag('temperatureC', v.temperatureC)}>
                {v.temperatureC ? `${v.temperatureC}°C` : '-'}
              </Vital>
              <Vital flag={vitalFlag('respiratoryRate', v.respiratoryRate)}>{v.respiratoryRate ?? '-'}</Vital>
              <td className="px-3 py-2.5">{v.urineOutputMl != null ? `${v.urineOutputMl} mL` : '-'}</td>
              <Vital flag={vitalFlag('bloodGlucose', v.bloodGlucose)}>{v.bloodGlucose ?? '-'}</Vital>
              <Vital flag={vitalFlag('spo2', v.spo2)}>{v.spo2 ? `${v.spo2}%` : '-'}</Vital>
              <td className="px-3 py-2.5">{v.avpu ?? '-'}</td>
              <td className="px-3 py-2.5 max-w-xs truncate text-gray-500">{v.notes ?? '-'}</td>
            </tr>
          ))}
        </TableShell>
      )}
      <AddVitalsModal patientId={id} open={add} onClose={() => setAdd(false)} />
    </>
  )
}

function Vital({ flag, children }: { flag: 'low' | 'high' | null; children: React.ReactNode }) {
  return (
    <td
      className={`px-3 py-2.5 ${flag ? 'text-red-600 font-semibold' : ''}`}
      title={flag ? `${flag === 'low' ? 'Below' : 'Above'} normal range` : undefined}
    >
      {children}
    </td>
  )
}

function Prescriptions({ id, role }: { id: string; role?: string }) {
  const [add, setAdd] = useState(false)
  const q = useQuery({ queryKey: ['prescriptions', id], queryFn: () => patientsApi.prescriptions(id) })
  return (
    <>
      <SectionHead
        title="Prescriptions"
        action={can(role, 'prescription:write') && <Button variant="secondary" onClick={() => setAdd(true)}>New prescription</Button>}
      />
      {!q.data?.length ? (
        <Empty>No prescriptions.</Empty>
      ) : (
        <TableShell head={['Date', 'Medicine', 'Dosage', 'Frequency', 'Route', 'Duration', 'Prescriber', 'Status', 'Dispensing']}>
          {q.data.flatMap((rx) =>
            rx.items.map((it, idx) => {
              const m = PRESCRIPTION_STATUS_META[rx.status]
              const dm = DISPENSE_STATUS_META[rx.dispenseStatus]
              return (
                <tr key={it.id} className="border-t border-gray-100">
                  <td className="px-3 py-2.5 text-gray-500">{idx === 0 ? d(rx.prescribedAt) : ''}</td>
                  <td className="px-3 py-2.5 font-medium text-gray-900">
                    {it.drugName}
                    {it.dosageForm && <span className="ml-1 text-xs text-gray-400">{it.dosageForm}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {[it.strengthConc, it.amountPerUse].filter(Boolean).join(' · ') || '-'}
                  </td>
                  <td className="px-3 py-2.5">{it.frequency ?? '-'}</td>
                  <td className="px-3 py-2.5">{it.route ?? '-'}</td>
                  <td className="px-3 py-2.5">
                    {it.durationNumber ? `${it.durationNumber} ${(it.durationType ?? 'Days').toLowerCase()}` : '-'}
                  </td>
                  <td className="px-3 py-2.5">{idx === 0 ? rx.prescribedByName ?? '-' : ''}</td>
                  <td className="px-3 py-2.5">
                    {idx === 0 && (
                      <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: m.color, backgroundColor: m.bg }}>
                        {m.label}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {idx === 0 && (
                      <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: dm.color, backgroundColor: dm.bg }}>
                        {dm.label}
                      </span>
                    )}
                  </td>
                </tr>
              )
            }),
          )}
        </TableShell>
      )}
      <AddPrescriptionModal patientId={id} open={add} onClose={() => setAdd(false)} />
    </>
  )
}

function PatientPhoto({ p, canEdit }: { p: PatientDTO; canEdit: boolean }) {
  const qc = useQueryClient()
  const ref = useRef<HTMLInputElement>(null)
  const m = useMutation({
    mutationFn: (f: File) => patientsApi.setPhoto(p.id, f),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patient', p.id] }),
  })
  return (
    <div className="relative flex-shrink-0 group">
      {p.photoUrl ? (
        <Image src={p.photoUrl} alt="" width={64} height={64} unoptimized className="w-16 h-16 rounded-full object-cover" />
      ) : (
        <span className="w-16 h-16 rounded-full bg-gray-100 text-gray-500 text-lg font-bold flex items-center justify-center">
          {p.firstName[0]}{p.lastName[0]}
        </span>
      )}
      {canEdit && (
        <>
          <input
            ref={ref}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) m.mutate(f) }}
          />
          <button
            onClick={() => ref.current?.click()}
            className="absolute inset-0 rounded-full bg-black/40 text-white text-[10px] font-medium opacity-0 group-hover:opacity-100 transition"
          >
            {m.isPending ? '…' : 'Change'}
          </button>
        </>
      )}
    </div>
  )
}

function Documents({ id, role }: { id: string; role?: string }) {
  const [add, setAdd] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const qc = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const q = useQuery({ queryKey: ['documents', id], queryFn: () => patientsApi.documents(id) })
  const del = useMutation({
    mutationFn: (docId: string) => patientsApi.deleteDocument(id, docId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents', id] })
      qc.invalidateQueries({ queryKey: ['patient', id] })
    },
    onError: () => toast('Could not delete the document.', 'error'),
  })
  const canEdit = can(role, 'patient:document')
  return (
    <>
      <SectionHead
        title="Documents"
        action={canEdit && <Button variant="secondary" onClick={() => setAdd(true)}>Add document</Button>}
      />
      {!q.data?.length ? (
        <Empty>No documents.</Empty>
      ) : (
        <div className="border border-gray-100 rounded-xl divide-y">
          {q.data.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{doc.title}</p>
                <p className="text-xs text-gray-400">
                  {doc.category.replace(/_/g, ' ')} · {d(doc.createdAt)}
                  {doc.fileName ? ` · ${doc.fileName}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                  disabled={opening === doc.id}
                  onClick={async () => {
                    setOpening(doc.id)
                    try {
                      const url = await patientsApi.documentUrl(id, doc.id)
                      window.open(url, '_blank', 'noopener')
                    } catch {
                      toast('Could not open the document.', 'error')
                    } finally {
                      setOpening(null)
                    }
                  }}
                >
                  {opening === doc.id ? 'Opening…' : 'Open'}
                </button>
                {canEdit && (
                  <button
                    className="text-xs text-red-500 hover:underline disabled:opacity-50"
                    disabled={del.isPending}
                    onClick={async () => {
                      if (await confirm({ title: 'Delete document', body: `Delete "${doc.title}"? This cannot be undone.`, confirmLabel: 'Delete', danger: true })) {
                        del.mutate(doc.id)
                      }
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <AddDocumentModal patientId={id} open={add} onClose={() => setAdd(false)} />
    </>
  )
}

function Invoices({ id, role, patientName: pName }: { id: string; role?: string; patientName: string }) {
  const q = useQuery({ queryKey: ['pt-invoices', id], queryFn: () => patientsApi.invoices(id) })
  const [pay, setPay] = useState<{ id: string; invoiceNumber: string; balanceDue: string } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const canPay = can(role, 'invoice:pay')
  // The invoice detail drawer reads GET /billing/invoices/:id, which the API
  // limits to billing roles. The list itself is fine (patient:read).
  const canViewDetail = can(role, 'billing:manage') || can(role, 'invoice:pay')
  if (!q.data) return <Empty>Loading…</Empty>
  if (!q.data.length) return <Empty>No invoices.</Empty>

  const totals = q.data.reduce(
    (acc, inv) => ({
      total: acc.total + Number(inv.totalAmount),
      paid: acc.paid + Number(inv.paidAmount),
      balance: acc.balance + Number(inv.balanceDue),
    }),
    { total: 0, paid: 0, balance: 0 },
  )
  const money = (n: number) => '₦' + n.toLocaleString()

  return (
    <>
      <SectionHead title="Invoices" />
      <TableShell head={['Invoice #', 'Date', 'Category', 'Amount', 'Paid', 'Balance due', 'Status', '']}>
        {q.data.map((inv) => {
          const m = INVOICE_STATUS_META[inv.status] ?? INVOICE_STATUS_META.UNPAID
          return (
            <tr
              key={inv.id}
              className={`border-t border-gray-100 ${canViewDetail ? 'hover:bg-gray-50 cursor-pointer' : ''}`}
              onClick={canViewDetail ? () => setOpenId(inv.id) : undefined}
            >
              <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{inv.invoiceNumber}</td>
              <td className="px-3 py-2.5 text-gray-500">{d(inv.createdAt)}</td>
              <td className="px-3 py-2.5">{inv.category ?? '-'}</td>
              <td className="px-3 py-2.5">{naira(inv.totalAmount)}</td>
              <td className="px-3 py-2.5 text-gray-500">{naira(inv.paidAmount)}</td>
              <td className="px-3 py-2.5 font-medium">{naira(inv.balanceDue)}</td>
              <td className="px-3 py-2.5">
                <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: m.color, backgroundColor: m.bg }}>
                  {m.label}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                {canPay && inv.status !== 'PAID' && inv.status !== 'CANCELLED' && (
                  <button
                    className="text-sm font-semibold text-primary hover:underline"
                    onClick={() => setPay({ id: inv.id, invoiceNumber: inv.invoiceNumber, balanceDue: inv.balanceDue })}
                  >
                    Pay
                  </button>
                )}
              </td>
            </tr>
          )
        })}
        <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-900">
          <td className="px-3 py-2.5" colSpan={3}>Total</td>
          <td className="px-3 py-2.5">{money(totals.total)}</td>
          <td className="px-3 py-2.5">{money(totals.paid)}</td>
          <td className="px-3 py-2.5">{money(totals.balance)}</td>
          <td className="px-3 py-2.5" colSpan={2} />
        </tr>
      </TableShell>

      <RecordPaymentModal
        open={!!pay}
        onClose={() => setPay(null)}
        invoice={pay ? { id: pay.id, invoiceNumber: pay.invoiceNumber, patientName: pName, balanceDue: pay.balanceDue } : null}
      />
      {canViewDetail && (
        <InvoiceDetailDrawer invoiceId={openId} open={!!openId} onClose={() => setOpenId(null)} />
      )}
    </>
  )
}
