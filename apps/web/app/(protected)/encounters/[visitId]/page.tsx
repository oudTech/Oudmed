'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { EncounterDTO } from '@oudhealth/contracts'
import { Button, Field, Input, Select, Textarea, Modal } from '@/components/ui/kit'
import { useConfirm } from '@/components/ui/feedback'
import { can } from '@/lib/permissions'
import {
  patientsApi,
  patientName,
  titleCase,
  vitalFlag,
  PRESCRIPTION_STATUS_META,
} from '@/lib/patients'
import {
  encountersApi,
  ORDER_STATUS_META,
  ORDER_TYPE_LABEL,
  DISPENSE_STATUS_META,
  ORDER_PRIORITIES,
} from '@/lib/encounters'
import { setVisitStatus, VISIT_STATUS_META, VISIT_TYPE_LABEL } from '@/lib/hospital'
import { timeLabel } from '@/lib/datetime'
import { trackFirst } from '@/lib/onboarding/analytics'
import {
  AddDiagnosisModal,
  AddVitalsModal,
  AddPrescriptionModal,
} from '@/components/patients/clinicalModals'

const naira = (v: string | number) => '₦' + Number(v).toLocaleString()
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB') : '-')

export default function EncounterPage() {
  const { visitId } = useParams<{ visitId: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { data: session } = useSession()
  const role = session?.role

  const allowed = can(role, 'patient:read')
  const q = useQuery({
    queryKey: ['encounter', visitId],
    queryFn: () => encountersApi.get(visitId),
    enabled: allowed,
  })
  const e = q.data

  const refresh = () => qc.invalidateQueries({ queryKey: ['encounter', visitId] })

  const complete = useMutation({
    mutationFn: () => setVisitStatus(visitId, 'COMPLETED'),
    onSuccess: () => {
      trackFirst('first_consultation_completed')
      qc.invalidateQueries({ queryKey: ['schedule'] })
      router.push('/schedule')
    },
  })

  const [modal, setModal] = useState<null | 'diagnosis' | 'vitals' | 'prescription' | 'order'>(null)

  if (!allowed) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Encounter</h1>
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6">
          The consultation workspace is available to clinical and front-desk staff.
        </p>
      </div>
    )
  }

  if (q.isLoading) return <div className="p-8 text-sm text-gray-400">Loading encounter…</div>
  if (!e) return <div className="p-8 text-sm text-gray-400">Encounter not found.</div>

  const meta = VISIT_STATUS_META[e.visit.status as keyof typeof VISIT_STATUS_META]
  const done = e.visit.status === 'COMPLETED' || e.visit.status === 'CANCELLED'
  const canDoc = can(role, 'diagnosis:record')
  const canNote = can(role, 'note:write')
  const canOrder = can(role, 'order:create')
  const canVitals = can(role, 'vitals:record')
  const canRx = can(role, 'prescription:write')

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* header */}
      <div className="px-8 py-4 flex items-center justify-between flex-shrink-0 border-b border-[#D6DEE8]">
        <div className="flex items-center gap-3 text-sm">
          <Link href="/schedule" className="text-gray-400 hover:text-gray-700">Schedule</Link>
          <span className="text-gray-300">/</span>
          <span className="font-semibold text-gray-900">Encounter</span>
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ color: meta.text, backgroundColor: meta.bg }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.dot }} />
            {meta.label}
          </span>
          <span className="text-xs text-gray-400">{VISIT_TYPE_LABEL[e.visit.visitType] ?? titleCase(e.visit.visitType)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/patients/${e.patient.id}`}
            className="text-sm text-gray-500 hover:text-gray-800 px-3 py-2"
          >
            Full chart
          </Link>
          {!done && can(role, 'appointment:complete') && (
            <Button
              loading={complete.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: 'Complete visit',
                    body: 'Complete this visit? The consultation fee will be added to the invoice.',
                    confirmLabel: 'Complete visit',
                  })
                ) {
                  complete.mutate()
                }
              }}
            >
              Complete visit
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* left rail: patient snapshot */}
        <aside className="w-72 flex-shrink-0 border-r border-gray-100 overflow-y-auto p-5 bg-[#FAFBFD]">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-12 h-12 rounded-full bg-gray-100 text-gray-500 font-bold flex items-center justify-center flex-shrink-0">
              {e.patient.firstName[0]}
              {e.patient.lastName[0]}
            </span>
            <div className="min-w-0">
              <Link href={`/patients/${e.patient.id}`} className="font-bold text-gray-900 hover:underline block truncate">
                {patientName(e.patient)}
              </Link>
              <p className="text-xs text-gray-400">
                {e.patient.age != null ? `${e.patient.age}y` : 'age ?'} · {e.patient.gender ?? '-'} · {e.patient.patientNumber}
              </p>
            </div>
          </div>

          {e.patient.allergies && e.patient.allergies.toLowerCase() !== 'none known' && (
            <div className="mb-3 rounded-lg bg-red-50 border border-red-100 px-3 py-2">
              <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">Allergies</p>
              <p className="text-sm text-red-800">{e.patient.allergies}</p>
            </div>
          )}

          <RailBlock label="Chronic conditions" value={e.patient.chronicConditions} />
          <RailBlock label="Current medications" value={e.patient.currentMedications} />
          <RailBlock
            label="Blood group / genotype"
            value={[e.patient.bloodGroup, e.patient.genotype].filter(Boolean).join(' · ') || null}
          />
          <RailBlock
            label="Payer"
            value={e.patient.payerType === 'CASH' ? 'Cash' : `${e.patient.payerType}${e.patient.hmoName ? ` · ${e.patient.hmoName}` : ''}`}
          />

          {e.lastVitals && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Last vitals</p>
              <p className="text-xs text-gray-600">{dt(e.lastVitals.recordedAt)}</p>
              <p className="text-sm text-gray-800">
                {e.lastVitals.systolicBp && e.lastVitals.diastolicBp ? `BP ${e.lastVitals.systolicBp}/${e.lastVitals.diastolicBp} · ` : ''}
                {e.lastVitals.pulseBpm ? `HR ${e.lastVitals.pulseBpm} · ` : ''}
                {e.lastVitals.temperatureC ? `${e.lastVitals.temperatureC}°C · ` : ''}
                {e.lastVitals.spo2 ? `SpO₂ ${e.lastVitals.spo2}%` : ''}
              </p>
            </div>
          )}
        </aside>

        {/* main */}
        <div className="flex-1 overflow-y-auto p-8 space-y-6 max-w-4xl">
          <p className="text-sm text-gray-400">
            {timeLabel(e.visit.startsAt)} · {e.visit.doctor?.fullName ?? 'Unassigned'} · {e.visit.department?.name ?? 'No department'}
            {e.visit.reason ? ` · ${e.visit.reason}` : ''}
          </p>

          <Complaints e={e} disabled={done} onDone={refresh} />

          <Section
            title="Vital signs"
            action={
              canVitals && !done && (
                <Button variant="secondary" onClick={() => setModal('vitals')}>Record vitals</Button>
              )
            }
          >
            {e.vitals.length === 0 ? (
              <Empty>No vitals recorded this visit.</Empty>
            ) : (
              <div className="border border-gray-100 rounded-xl overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>{['Time', 'BP', 'HR', 'Temp', 'RR', 'SpO₂', 'BS(R)', 'AVPU'].map((h) => <th key={h} className="text-left font-medium px-3 py-2">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {e.vitals.map((v) => (
                      <tr key={v.id} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-gray-500">{timeLabel(v.recordedAt)}</td>
                        <VCell flag={vitalFlag('systolicBp', v.systolicBp) ?? vitalFlag('diastolicBp', v.diastolicBp)}>{v.systolicBp && v.diastolicBp ? `${v.systolicBp}/${v.diastolicBp}` : '-'}</VCell>
                        <VCell flag={vitalFlag('pulseBpm', v.pulseBpm)}>{v.pulseBpm ?? '-'}</VCell>
                        <VCell flag={vitalFlag('temperatureC', v.temperatureC)}>{v.temperatureC ? `${v.temperatureC}°` : '-'}</VCell>
                        <VCell flag={vitalFlag('respiratoryRate', v.respiratoryRate)}>{v.respiratoryRate ?? '-'}</VCell>
                        <VCell flag={vitalFlag('spo2', v.spo2)}>{v.spo2 ? `${v.spo2}%` : '-'}</VCell>
                        <VCell flag={vitalFlag('bloodGlucose', v.bloodGlucose)}>{v.bloodGlucose ?? '-'}</VCell>
                        <td className="px-3 py-2">{v.avpu ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section
            title="Diagnoses"
            action={canDoc && !done && <Button variant="secondary" onClick={() => setModal('diagnosis')}>Add diagnosis</Button>}
          >
            {e.diagnoses.length === 0 ? (
              <Empty>No diagnosis recorded.</Empty>
            ) : (
              <ul className="border border-gray-100 rounded-xl divide-y">
                {e.diagnoses.map((dx) => (
                  <li key={dx.id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900">
                        {dx.description}
                        {dx.code && <span className="ml-1 text-xs text-gray-400 font-mono">{dx.code}</span>}
                      </p>
                      <span className="text-xs text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">{titleCase(dx.certainty)}</span>
                    </div>
                    {dx.notes && <p className="text-xs text-gray-400 mt-0.5">{dx.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Orders e={e} disabled={done} canOrder={canOrder} role={role} onOpen={() => setModal('order')} onDone={refresh} />

          <Section
            title="Prescriptions"
            action={canRx && !done && <Button variant="secondary" onClick={() => setModal('prescription')}>New prescription</Button>}
          >
            {e.prescriptions.length === 0 ? (
              <Empty>No prescription written.</Empty>
            ) : (
              <div className="space-y-2">
                {e.prescriptions.map((rx) => {
                  const rm = PRESCRIPTION_STATUS_META[rx.status]
                  const dm = DISPENSE_STATUS_META[rx.dispenseStatus]
                  return (
                    <div key={rx.id} className="border border-gray-100 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: rm.color, backgroundColor: rm.bg }}>{rm.label}</span>
                        <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: dm.color, backgroundColor: dm.bg }}>{dm.label}</span>
                      </div>
                      <ul className="text-sm text-gray-800 space-y-0.5">
                        {rx.items.map((it) => (
                          <li key={it.id}>
                            <span className="font-medium">{it.drugName}</span>
                            {it.strengthConc && ` ${it.strengthConc}`}
                            {it.frequency && ` · ${it.frequency}`}
                            {it.durationNumber && ` · ${it.durationNumber} ${(it.durationType ?? 'days').toLowerCase()}`}
                          </li>
                        ))}
                      </ul>
                      {rx.notes && <p className="text-xs text-gray-400 mt-2">{rx.notes}</p>}
                    </div>
                  )
                })}
              </div>
            )}
          </Section>

          <NoteEditor e={e} disabled={done || !canNote} visitId={visitId} />

          <Charges e={e} />
        </div>
      </div>

      <AddVitalsModal patientId={e.patient.id} visitId={visitId} open={modal === 'vitals'} onClose={() => { setModal(null); refresh() }} />
      <AddDiagnosisModal patientId={e.patient.id} visitId={visitId} open={modal === 'diagnosis'} onClose={() => { setModal(null); refresh() }} />
      <AddPrescriptionModal patientId={e.patient.id} visitId={visitId} open={modal === 'prescription'} onClose={() => { setModal(null); refresh() }} />
      <OrderModal visitId={visitId} open={modal === 'order'} onClose={() => { setModal(null); refresh() }} />
    </div>
  )
}

function RailBlock({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="mb-2.5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm text-gray-800">{value}</p>
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-bold text-gray-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl p-4 text-center">{children}</p>
}

function VCell({ flag, children }: { flag: 'low' | 'high' | null; children: React.ReactNode }) {
  return <td className={`px-3 py-2 ${flag ? 'text-red-600 font-semibold' : ''}`}>{children}</td>
}

function Complaints({ e, disabled, onDone }: { e: EncounterDTO; disabled: boolean; onDone: () => void }) {
  const [text, setText] = useState('')
  const [onset, setOnset] = useState('')
  const [severity, setSeverity] = useState('')
  const m = useMutation({
    mutationFn: () =>
      patientsApi.addComplaint(e.patient.id, {
        description: text.trim(),
        onsetNote: onset || undefined,
        severity: severity || undefined,
        visitId: e.visit.id,
      }),
    onSuccess: () => {
      setText(''); setOnset(''); setSeverity('')
      onDone()
    },
  })
  return (
    <Section title="Presenting complaint">
      {!disabled && (
        <div className="border border-gray-100 rounded-xl p-4 mb-3">
          <Textarea rows={2} value={text} onChange={(ev) => setText(ev.target.value)} placeholder="What is the patient presenting with?" />
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <input className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-44" value={onset} onChange={(ev) => setOnset(ev.target.value)} placeholder="Onset e.g. 3 days ago" />
            <select className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm" value={severity} onChange={(ev) => setSeverity(ev.target.value)}>
              <option value="">Severity</option><option>Mild</option><option>Moderate</option><option>Severe</option>
            </select>
            <div className="ml-auto">
              <Button loading={m.isPending} disabled={text.trim().length < 2} onClick={() => m.mutate()}>Add</Button>
            </div>
          </div>
        </div>
      )}
      {e.complaints.length === 0 ? (
        <Empty>No complaint recorded.</Empty>
      ) : (
        <ul className="border border-gray-100 rounded-xl divide-y">
          {e.complaints.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <p className="text-sm text-gray-900">{c.description}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {[c.severity, c.onsetNote, c.recordedByName].filter(Boolean).join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function Orders({
  e,
  disabled,
  canOrder,
  role,
  onOpen,
  onDone,
}: {
  e: EncounterDTO
  disabled: boolean
  canOrder: boolean
  role?: string
  onOpen: () => void
  onDone: () => void
}) {
  const canResult = can(role, 'order:result')
  const cancel = useMutation({
    mutationFn: (id: string) => encountersApi.updateOrder(id, { status: 'CANCELLED' }),
    onSuccess: onDone,
  })
  return (
    <Section
      title="Investigations"
      action={canOrder && !disabled && <Button variant="secondary" onClick={onOpen}>Order</Button>}
    >
      {e.orders.length === 0 ? (
        <Empty>No investigations ordered.</Empty>
      ) : (
        <ul className="border border-gray-100 rounded-xl divide-y">
          {e.orders.map((o) => {
            const om = ORDER_STATUS_META[o.status]
            return (
              <li key={o.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-900">
                    {o.name}
                    <span className="ml-2 text-xs text-gray-400">{ORDER_TYPE_LABEL[o.orderType]}{o.priority && o.priority !== 'Routine' ? ` · ${o.priority}` : ''}</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: om.color, backgroundColor: om.bg }}>{om.label}</span>
                    {!disabled && canOrder && (o.status === 'ORDERED' || o.status === 'IN_PROGRESS') && (
                      <button className="text-xs text-gray-400 hover:text-red-500" onClick={() => cancel.mutate(o.id)}>Cancel</button>
                    )}
                  </div>
                </div>
                {o.status === 'RESULTED' && (
                  <p className="text-sm text-gray-700 mt-1">
                    <span className={o.abnormalFlag && o.abnormalFlag !== 'Normal' ? 'text-red-600 font-semibold' : 'font-medium'}>
                      {o.resultValue} {o.resultUnit}
                    </span>
                    {o.referenceRange && <span className="text-gray-400"> (ref {o.referenceRange})</span>}
                    {o.resultNote && <span className="text-gray-500"> · {o.resultNote}</span>}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

function NoteEditor({ e, disabled, visitId }: { e: EncounterDTO; disabled: boolean; visitId: string }) {
  const qc = useQueryClient()
  const [f, setF] = useState({
    subjective: e.note?.subjective ?? '',
    objective: e.note?.objective ?? '',
    assessment: e.note?.assessment ?? '',
    plan: e.note?.plan ?? '',
  })
  useEffect(() => {
    setF({
      subjective: e.note?.subjective ?? '',
      objective: e.note?.objective ?? '',
      assessment: e.note?.assessment ?? '',
      plan: e.note?.plan ?? '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.note?.id, visitId])

  const m = useMutation({
    mutationFn: () => encountersApi.saveNote(visitId, f),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['encounter', visitId] }),
  })
  const dirty =
    f.subjective !== (e.note?.subjective ?? '') ||
    f.objective !== (e.note?.objective ?? '') ||
    f.assessment !== (e.note?.assessment ?? '') ||
    f.plan !== (e.note?.plan ?? '')

  const FIELDS: [keyof typeof f, string][] = [
    ['subjective', 'Subjective'],
    ['objective', 'Objective'],
    ['assessment', 'Assessment'],
    ['plan', 'Plan'],
  ]

  return (
    <Section
      title="Consultation note"
      action={!disabled && <Button loading={m.isPending} disabled={!dirty} onClick={() => m.mutate()}>Save note</Button>}
    >
      <div className="border border-gray-100 rounded-xl p-5 space-y-4">
        {FIELDS.map(([k, label]) => (
          <div key={k}>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1 block">{label}</label>
            {disabled ? (
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{f[k] || <span className="text-gray-400">Not recorded</span>}</p>
            ) : (
              <Textarea rows={3} value={f[k]} onChange={(ev) => setF({ ...f, [k]: ev.target.value })} />
            )}
          </div>
        ))}
        {e.note && <p className="text-xs text-gray-400">Last saved {dt(e.note.updatedAt)}{e.note.authorName ? ` by ${e.note.authorName}` : ''}</p>}
      </div>
    </Section>
  )
}

function Charges({ e }: { e: EncounterDTO }) {
  return (
    <Section title="Charges">
      {!e.invoice ? (
        <Empty>Nothing billed yet.</Empty>
      ) : (
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>{['Item', 'Category', 'Qty', 'Amount'].map((h) => <th key={h} className="text-left font-medium px-3 py-2">{h}</th>)}</tr>
            </thead>
            <tbody>
              {e.invoice.lines.map((l) => (
                <tr key={l.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">{l.description}</td>
                  <td className="px-3 py-2 text-gray-500">{l.category ?? '-'}</td>
                  <td className="px-3 py-2">{l.quantity}</td>
                  <td className="px-3 py-2">{naira(l.lineTotal)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                <td className="px-3 py-2" colSpan={3}>Total</td>
                <td className="px-3 py-2">{naira(e.invoice.totalAmount)}</td>
              </tr>
              <tr className="text-gray-500">
                <td className="px-3 py-1.5" colSpan={3}>Paid</td>
                <td className="px-3 py-1.5">{naira(e.invoice.paidAmount)}</td>
              </tr>
              <tr className="font-semibold">
                <td className="px-3 py-1.5" colSpan={3}>Balance due</td>
                <td className="px-3 py-1.5">{naira(e.invoice.balanceDue)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-400 mt-2">Invoice {e.invoice?.invoiceNumber ?? ''} · settle at the cashier from the patient chart.</p>
    </Section>
  )
}

function OrderModal({ visitId, open, onClose }: { visitId: string; open: boolean; onClose: () => void }) {
  const [orderType, setOrderType] = useState<'LABORATORY' | 'IMAGING' | 'PROCEDURE'>('LABORATORY')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<{ id: string; name: string; unitPrice: string } | null>(null)
  const [priority, setPriority] = useState('Routine')
  const [note, setNote] = useState('')
  const category = orderType === 'LABORATORY' ? 'Laboratory' : orderType === 'IMAGING' ? 'Imaging' : 'Procedure'

  const items = useQuery({
    queryKey: ['service-items', category, q],
    queryFn: () => encountersApi.serviceItems(category, q || undefined),
    enabled: open,
  })

  const m = useMutation({
    mutationFn: () =>
      encountersApi.createOrder(visitId, {
        orderType,
        serviceItemId: picked!.id,
        priority,
        clinicalNote: note || undefined,
      }),
    onSuccess: () => {
      setPicked(null); setQ(''); setNote(''); setPriority('Routine')
      onClose()
    },
  })

  return (
    <Modal open={open} onClose={onClose} title="Order investigation" width={520} align="center">
      <div className="space-y-3">
        <Field label="Type">
          <Select value={orderType} onChange={(ev) => { setOrderType(ev.target.value as any); setPicked(null) }}>
            <option value="LABORATORY">Laboratory</option>
            <option value="IMAGING">Imaging</option>
            <option value="PROCEDURE">Procedure</option>
          </Select>
        </Field>
        <Field label="Search catalogue">
          <Input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="e.g. Full Blood Count" />
        </Field>
        <div className="border border-gray-100 rounded-lg max-h-52 overflow-y-auto divide-y">
          {(items.data ?? []).map((it) => (
            <button
              key={it.id}
              onClick={() => setPicked({ id: it.id, name: it.name, unitPrice: it.unitPrice })}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-gray-50 ${picked?.id === it.id ? 'bg-blue-50' : ''}`}
            >
              <span>{it.name}</span>
              <span className="text-gray-400">₦{Number(it.unitPrice).toLocaleString()}</span>
            </button>
          ))}
          {items.data && items.data.length === 0 && (
            <p className="px-3 py-3 text-sm text-gray-400">No matching {category.toLowerCase()} items.</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority">
            <Select value={priority} onChange={(ev) => setPriority(ev.target.value)}>
              {ORDER_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Clinical details for the lab">
          <Textarea rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Relevant history / what to look for" />
        </Field>
        {m.isError && <p className="text-sm text-red-600">Could not place the order.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={!picked} onClick={() => m.mutate()}>
            {picked ? `Order ${picked.name} (₦${Number(picked.unitPrice).toLocaleString()})` : 'Order'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
