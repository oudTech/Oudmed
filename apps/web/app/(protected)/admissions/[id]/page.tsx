'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { Button, Field, Input, Select, Textarea, Modal } from '@/components/ui/kit'
import { useToast } from '@/components/ui/feedback'
import { can } from '@/lib/permissions'
import { patientsApi, patientName } from '@/lib/patients'
import { naira } from '@/lib/billing'
import {
  getAdmissionWorkspace,
  getAdmissionBill,
  addAdmissionDeposit,
  refundAdmissionDeposit,
  applyAdmissionDeposit,
  reopenAdmission,
  addAdmissionNote,
  addAdmissionNoteAddendum,
} from '@/lib/hospital'
import {
  AddDiagnosisModal,
  AddVitalsModal,
  AddPrescriptionModal,
} from '@/components/patients/clinicalModals'
import { OrderModal } from '@/components/encounters/OrderModal'
import { ORDER_STATUS_META, ORDER_TYPE_LABEL } from '@/lib/encounters'
import { AdmissionBillPrintModal } from '@/components/patients/AdmissionBillPrintModal'
import { DischargeSummaryPrintModal } from '@/components/patients/DischargeSummaryPrintModal'

const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB') : '-')
const d = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB') : '-')

export default function AdmissionWorkspacePage() {
  const { id } = useParams<{ id: string }>()
  const { data: session } = useSession()
  const role = session?.role
  const qc = useQueryClient()
  const toast = useToast()
  const allowed = can(role, 'patient:read')

  const ws = useQuery({ queryKey: ['admission-workspace', id], queryFn: () => getAdmissionWorkspace(id), enabled: allowed })
  const canBilling = can(role, 'billing:manage')
  const bill = useQuery({ queryKey: ['admission-bill', id], queryFn: () => getAdmissionBill(id), enabled: canBilling })

  const [addVitals, setAddVitals] = useState(false)
  const [addDiagnosis, setAddDiagnosis] = useState(false)
  const [addRx, setAddRx] = useState(false)
  const [addOrder, setAddOrder] = useState(false)
  const [showBill, setShowBill] = useState(false)
  const [addingDeposit, setAddingDeposit] = useState(false)
  const [applyingDeposit, setApplyingDeposit] = useState(false)
  const [refunding, setRefunding] = useState<{ id: string; max: number } | null>(null)
  const [complaintText, setComplaintText] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [addendumFor, setAddendumFor] = useState<string | null>(null)
  const [reopening, setReopening] = useState(false)
  const [showDischargeSummary, setShowDischargeSummary] = useState(false)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admission-workspace', id] })
    qc.invalidateQueries({ queryKey: ['admission-bill', id] })
  }

  const addComplaint = useMutation({
    mutationFn: () => patientsApi.addComplaint(a!.patient.id, { description: complaintText.trim(), admissionId: id }),
    onSuccess: () => { setComplaintText(''); refresh() },
    onError: () => toast('Could not add the complaint.', 'error'),
  })

  if (!allowed) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Admission</h1>
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6">
          The inpatient workspace is available to clinical and front-desk staff.
        </p>
      </div>
    )
  }
  if (!ws.data) return <div className="p-8 text-sm text-gray-400">Loading…</div>

  const a = ws.data.admission
  const days = Math.max(1, Math.ceil((Date.now() - new Date(a.admittedAt).getTime()) / 86400000))

  return (
    <div className="flex flex-col h-full bg-[#F7F9FC] overflow-y-auto">
      <div className="px-8 pt-7 pb-4 bg-white border-b border-[#D6DEE8]">
        <Link href="/wards" className="text-sm text-gray-400 hover:text-gray-700">&larr; Wards &amp; beds</Link>
        <div className="flex items-start justify-between mt-1">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{patientName(a.patient as any)}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {a.admissionNumber} · {a.ward?.name ?? '-'} / {a.bed?.label ?? '-'} · day {days} ·
              {' '}{a.status === 'ADMITTED' ? 'Admitted' : a.status} {dt(a.admittedAt)}
              {a.attendingDoctor ? ` · Dr. ${a.attendingDoctor.fullName}` : ''}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Deposit held</p>
            <p className="text-xl font-bold text-gray-900">{naira(ws.data.totalDeposited)}</p>
            {a.status !== 'ADMITTED' && (
              <div className="mt-2 flex gap-2 justify-end">
                <Button variant="secondary" onClick={() => setShowDischargeSummary(true)}>Discharge summary</Button>
                {can(role, 'admission:reopen') && (
                  <Button variant="secondary" onClick={() => setReopening(true)}>Reopen</Button>
                )}
              </div>
            )}
          </div>
        </div>
        {a.reopenedAt && (
          <div className="mt-3 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-sm text-blue-800">
            Reopened {dt(a.reopenedAt)} for a late correction - this does not readmit the patient.
          </div>
        )}
        {a.status === 'ADMITTED' && !a.ward?.dailyRate && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            Ward rate not set - bed charges on hold. Once a rate is set for {a.ward?.name ?? 'this ward'}, every missed night posts automatically.
          </div>
        )}
      </div>

      <div className="flex-1 p-8 space-y-6 max-w-5xl">
        {canBilling && bill.data && (
          <Card title={a.status === 'ADMITTED' ? 'Running bill (interim)' : 'Running bill'} action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowBill(true)}>Print bill</Button>
              {Number(bill.data.totalDeposited) > 0 && Number(bill.data.balance) > 0 && (
                <Button variant="secondary" onClick={() => setApplyingDeposit(true)}>Apply deposit</Button>
              )}
              <Button variant="secondary" onClick={() => setAddingDeposit(true)}>+ Deposit</Button>
            </div>
          }>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Stat label="Charged" value={naira(bill.data.totalCharged)} />
              <Stat label="Paid" value={naira(bill.data.totalPaid)} />
              <Stat label="Deposit held" value={naira(bill.data.totalDeposited)} />
              <Stat label="Balance" value={naira(bill.data.balance)} tone={Number(bill.data.balance) > 0 ? '#DC2626' : '#047857'} />
            </div>
            {bill.data.deposits.length > 0 && (
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Deposits</p>
                <ul className="text-sm divide-y divide-gray-100">
                  {bill.data.deposits.map((dep) => {
                    const remaining = Number(dep.amount) - Number(dep.refundedAmount ?? 0)
                    return (
                      <li key={dep.id} className="py-2 flex items-center justify-between">
                        <span>
                          {naira(dep.amount)} · {dep.method} · {dep.receiptNumber ?? '-'} · {d(dep.receivedAt)}
                          {dep.refundedAmount && (
                            <span className="text-gray-400"> · refunded {naira(dep.refundedAmount)}</span>
                          )}
                        </span>
                        {can(role, 'admission:deposit-refund') && remaining > 0 && (
                          <button
                            className="text-xs text-gray-400 hover:text-red-500"
                            onClick={() => setRefunding({ id: dep.id, max: remaining })}
                          >
                            Refund
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </Card>
        )}

        <Card title="Complaints">
          {can(role, 'complaint:record') && (
            <div className="flex gap-2 mb-3">
              <Textarea rows={2} value={complaintText} onChange={(e) => setComplaintText(e.target.value)} placeholder="Add a complaint" className="flex-1" />
              <Button disabled={complaintText.trim().length < 2} loading={addComplaint.isPending} onClick={() => addComplaint.mutate()}>Add</Button>
            </div>
          )}
          {!ws.data.complaints.length ? <Empty /> : (
            <ul className="text-sm divide-y divide-gray-100">
              {ws.data.complaints.map((c: any) => (
                <li key={c.id} className="py-2">{c.description} <span className="text-gray-400 text-xs">· {dt(c.recordedAt)}</span></li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Vital signs" action={can(role, 'vitals:record') && <Button variant="secondary" onClick={() => setAddVitals(true)}>+ Add vitals</Button>}>
          {!ws.data.vitals.length ? <Empty /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-gray-400"><tr>{['Date', 'Temp', 'Pulse', 'BP', 'SpO2', 'Weight'].map((h) => <th key={h} className="text-left font-medium py-1.5 pr-4">{h}</th>)}</tr></thead>
                <tbody>
                  {ws.data.vitals.map((v: any) => (
                    <tr key={v.id} className="border-t border-gray-100">
                      <td className="py-1.5 pr-4 text-gray-500">{dt(v.recordedAt)}</td>
                      <td className="py-1.5 pr-4">{v.temperatureC ?? '-'}</td>
                      <td className="py-1.5 pr-4">{v.pulseBpm ?? '-'}</td>
                      <td className="py-1.5 pr-4">{v.systolicBp ?? '-'}/{v.diastolicBp ?? '-'}</td>
                      <td className="py-1.5 pr-4">{v.spo2 ?? '-'}</td>
                      <td className="py-1.5 pr-4">{v.weightKg ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Diagnoses" action={can(role, 'diagnosis:record') && <Button variant="secondary" onClick={() => setAddDiagnosis(true)}>+ Add diagnosis</Button>}>
          {!ws.data.diagnoses.length ? <Empty /> : (
            <ul className="text-sm divide-y divide-gray-100">
              {ws.data.diagnoses.map((dg: any) => (
                <li key={dg.id} className="py-2">{dg.description} <span className="text-gray-400 text-xs">· {dg.certainty} · {dt(dg.diagnosedAt)}</span></li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Prescriptions" action={can(role, 'prescription:write') && <Button variant="secondary" onClick={() => setAddRx(true)}>+ New prescription</Button>}>
          {!ws.data.prescriptions.length ? <Empty /> : (
            <ul className="text-sm divide-y divide-gray-100">
              {ws.data.prescriptions.map((rx: any) => (
                <li key={rx.id} className="py-2">
                  {rx.items.map((it: any) => it.drugName).join(', ')}
                  <span className="text-gray-400 text-xs"> · {dt(rx.prescribedAt)} · {rx.dispenseStatus}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Orders" action={can(role, 'order:create') && <Button variant="secondary" onClick={() => setAddOrder(true)}>+ Order investigation</Button>}>
          {!ws.data.orders.length ? <Empty /> : (
            <ul className="text-sm divide-y divide-gray-100">
              {ws.data.orders.map((o: any) => {
                const meta = ORDER_STATUS_META[o.status]
                return (
                  <li key={o.id} className="py-2 flex items-center justify-between">
                    <span>
                      {o.name}
                      <span className="text-gray-400 text-xs"> · {ORDER_TYPE_LABEL[o.orderType]} · {dt(o.orderedAt)}</span>
                    </span>
                    {meta && (
                      <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ color: meta.color, backgroundColor: meta.bg }}>
                        {meta.label}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card title="Ward-round notes" action={can(role, 'note:write') && (a.status === 'ADMITTED' || a.reopenedAt) && (
          <Button variant="secondary" onClick={() => setAddingNote(true)}>+ Add note</Button>
        )}>
          {!ws.data.notes.length ? <Empty /> : (
            <ul className="space-y-3">
              {ws.data.notes.map((n) => (
                <li key={n.id} className="border border-gray-100 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-gray-500">{n.authorName ?? 'Unknown'} · {dt(n.createdAt)}</span>
                    {can(role, 'note:write') && (
                      <button className="text-xs text-primary hover:underline" onClick={() => setAddendumFor(n.id)}>+ Addendum</button>
                    )}
                  </div>
                  <div className="text-sm text-gray-700 space-y-0.5">
                    {n.subjective && <p><span className="font-medium">S:</span> {n.subjective}</p>}
                    {n.objective && <p><span className="font-medium">O:</span> {n.objective}</p>}
                    {n.assessment && <p><span className="font-medium">A:</span> {n.assessment}</p>}
                    {n.plan && <p><span className="font-medium">P:</span> {n.plan}</p>}
                  </div>
                  {n.addenda.length > 0 && (
                    <ul className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                      {n.addenda.map((ad) => (
                        <li key={ad.id} className="text-xs text-gray-500">
                          <span className="font-semibold">Addendum</span> · {ad.authorName ?? 'Unknown'} · {dt(ad.createdAt)}
                          {ad.plan && <span> - {ad.plan}</span>}
                          {ad.assessment && <span> - {ad.assessment}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <AddVitalsModal patientId={a.patient.id} admissionId={id} open={addVitals} onClose={() => { setAddVitals(false); refresh() }} />
      <AddDiagnosisModal patientId={a.patient.id} admissionId={id} open={addDiagnosis} onClose={() => { setAddDiagnosis(false); refresh() }} />
      <AddPrescriptionModal patientId={a.patient.id} admissionId={id} open={addRx} onClose={() => { setAddRx(false); refresh() }} />
      <OrderModal admissionId={id} open={addOrder} onClose={() => { setAddOrder(false); refresh() }} />
      <AdmissionBillPrintModal
        bill={bill.data ?? null}
        patient={{ name: patientName(a.patient as any), patientNumber: a.patient.patientNumber }}
        open={showBill}
        onClose={() => setShowBill(false)}
      />
      <AddDepositModal admissionId={id} open={addingDeposit} onClose={() => setAddingDeposit(false)} onDone={refresh} />
      <RefundDepositModal admissionId={id} deposit={refunding} onClose={() => setRefunding(null)} onDone={refresh} />
      <ApplyDepositModal
        admissionId={id}
        max={bill.data ? Math.min(Number(bill.data.totalDeposited), Number(bill.data.balance)) : 0}
        open={applyingDeposit}
        onClose={() => setApplyingDeposit(false)}
        onDone={refresh}
      />
      <AddNoteModal admissionId={id} open={addingNote} onClose={() => setAddingNote(false)} onDone={refresh} />
      <AddNoteAddendumModal admissionId={id} noteId={addendumFor} onClose={() => setAddendumFor(null)} onDone={refresh} />
      <ReopenModal admissionId={id} open={reopening} onClose={() => setReopening(false)} onDone={refresh} />
      <DischargeSummaryPrintModal admissionId={id} open={showDischargeSummary} onClose={() => setShowDischargeSummary(false)} />
    </div>
  )
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-gray-900">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value, tone = '#111827' }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="font-bold" style={{ color: tone }}>{value}</p>
    </div>
  )
}

function Empty() {
  return <p className="text-sm text-gray-400">Nothing recorded yet.</p>
}

function AddDepositModal({ admissionId, open, onClose, onDone }: { admissionId: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('CASH')
  const [reference, setReference] = useState('')

  const m = useMutation({
    mutationFn: () => addAdmissionDeposit(admissionId, { amount: Number(amount), method, reference: reference || undefined }),
    onSuccess: (res) => {
      toast(`Deposit recorded - receipt ${res.receiptNumber}`, 'success')
      setAmount(''); setReference(''); onClose(); onDone()
    },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not record the deposit.', 'error'),
  })

  return (
    <Modal open={open} onClose={onClose} title="Record a deposit" width={400} align="center">
      <div className="space-y-3">
        <Field label="Amount (₦)" required>
          <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="TRANSFER">Transfer</option>
          </Select>
        </Field>
        <Field label="Reference (optional)">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={!Number(amount)} onClick={() => m.mutate()}>Record deposit</Button>
        </div>
      </div>
    </Modal>
  )
}

function RefundDepositModal({ admissionId, deposit, onClose, onDone }: { admissionId: string; deposit: { id: string; max: number } | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')

  const key = deposit?.id ?? ''
  const [seen, setSeen] = useState(key)
  if (key !== seen) {
    setSeen(key)
    setAmount(deposit ? String(deposit.max) : '')
    setReason('')
  }

  const m = useMutation({
    mutationFn: () => refundAdmissionDeposit(admissionId, deposit!.id, { amount: Number(amount), reason: reason.trim() }),
    onSuccess: () => { toast('Refund recorded', 'success'); onClose(); onDone() },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not record the refund.', 'error'),
  })

  if (!deposit) return null
  return (
    <Modal open={!!deposit} onClose={onClose} title="Refund deposit" width={400} align="center">
      <div className="space-y-3">
        <Field label={`Amount (₦, up to ${deposit.max})`} required>
          <Input type="number" min={0} max={deposit.max} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reason" required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            loading={m.isPending}
            disabled={!Number(amount) || Number(amount) > deposit.max || reason.trim().length < 3}
            onClick={() => m.mutate()}
          >
            Confirm refund
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ApplyDepositModal({ admissionId, max, open, onClose, onDone }: { admissionId: string; max: number; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')

  const key = `${open}-${max}`
  const [seen, setSeen] = useState(key)
  if (key !== seen) { setSeen(key); setAmount(max > 0 ? String(max) : '') }

  const m = useMutation({
    mutationFn: () => applyAdmissionDeposit(admissionId, Number(amount)),
    onSuccess: () => { toast('Deposit applied to the bill', 'success'); onClose(); onDone() },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not apply the deposit.', 'error'),
  })

  return (
    <Modal open={open} onClose={onClose} title="Apply deposit to the bill" width={400} align="center">
      <div className="space-y-3">
        <Field label={`Amount (₦, up to ${max})`} required>
          <Input type="number" min={0} max={max} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <p className="text-xs text-gray-400">Converts deposit credit into a real payment against the amount owed - this is recognised as revenue now, not when the deposit was first taken.</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={!Number(amount) || Number(amount) > max} onClick={() => m.mutate()}>Apply</Button>
        </div>
      </div>
    </Modal>
  )
}

function AddNoteModal({ admissionId, open, onClose, onDone }: { admissionId: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [d, setD] = useState({ subjective: '', objective: '', assessment: '', plan: '' })

  const key = String(open)
  const [seen, setSeen] = useState(key)
  if (key !== seen) { setSeen(key); setD({ subjective: '', objective: '', assessment: '', plan: '' }) }

  const m = useMutation({
    mutationFn: () => addAdmissionNote(admissionId, {
      subjective: d.subjective || undefined, objective: d.objective || undefined,
      assessment: d.assessment || undefined, plan: d.plan || undefined,
    }),
    onSuccess: () => { onClose(); onDone() },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not save the note.', 'error'),
  })
  const empty = !d.subjective.trim() && !d.objective.trim() && !d.assessment.trim() && !d.plan.trim()

  return (
    <Modal open={open} onClose={onClose} title="Ward-round note" width={520} align="center">
      <div className="space-y-3">
        <Field label="Subjective"><Textarea rows={2} value={d.subjective} onChange={(e) => setD({ ...d, subjective: e.target.value })} /></Field>
        <Field label="Objective"><Textarea rows={2} value={d.objective} onChange={(e) => setD({ ...d, objective: e.target.value })} /></Field>
        <Field label="Assessment"><Textarea rows={2} value={d.assessment} onChange={(e) => setD({ ...d, assessment: e.target.value })} /></Field>
        <Field label="Plan"><Textarea rows={2} value={d.plan} onChange={(e) => setD({ ...d, plan: e.target.value })} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={empty} onClick={() => m.mutate()}>Save note</Button>
        </div>
      </div>
    </Modal>
  )
}

function AddNoteAddendumModal({ admissionId, noteId, onClose, onDone }: { admissionId: string; noteId: string | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [d, setD] = useState({ subjective: '', objective: '', assessment: '', plan: '' })

  const key = noteId ?? ''
  const [seen, setSeen] = useState(key)
  if (key !== seen) { setSeen(key); setD({ subjective: '', objective: '', assessment: '', plan: '' }) }

  const m = useMutation({
    mutationFn: () => addAdmissionNoteAddendum(admissionId, noteId!, {
      subjective: d.subjective || undefined, objective: d.objective || undefined,
      assessment: d.assessment || undefined, plan: d.plan || undefined,
    }),
    onSuccess: () => { onClose(); onDone() },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not save the addendum.', 'error'),
  })
  const empty = !d.subjective.trim() && !d.objective.trim() && !d.assessment.trim() && !d.plan.trim()

  if (!noteId) return null
  return (
    <Modal open={!!noteId} onClose={onClose} title="Add addendum" width={520} align="center">
      <div className="space-y-3">
        <p className="text-xs text-gray-400">A late correction to this note - the original stays unchanged.</p>
        <Field label="Subjective"><Textarea rows={2} value={d.subjective} onChange={(e) => setD({ ...d, subjective: e.target.value })} /></Field>
        <Field label="Objective"><Textarea rows={2} value={d.objective} onChange={(e) => setD({ ...d, objective: e.target.value })} /></Field>
        <Field label="Assessment"><Textarea rows={2} value={d.assessment} onChange={(e) => setD({ ...d, assessment: e.target.value })} /></Field>
        <Field label="Plan"><Textarea rows={2} value={d.plan} onChange={(e) => setD({ ...d, plan: e.target.value })} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={empty} onClick={() => m.mutate()}>Save addendum</Button>
        </div>
      </div>
    </Modal>
  )
}

function ReopenModal({ admissionId, open, onClose, onDone }: { admissionId: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')

  const m = useMutation({
    mutationFn: () => reopenAdmission(admissionId, reason.trim()),
    onSuccess: () => { toast('Admission reopened', 'success'); setReason(''); onClose(); onDone() },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not reopen the admission.', 'error'),
  })

  return (
    <Modal open={open} onClose={onClose} title="Reopen admission" width={440} align="center">
      <div className="space-y-3">
        <p className="text-sm text-gray-500">
          Lifts the closed-admission guard for a bounded correction (a late lab result, a note that needs
          amending). This does not readmit the patient, free a bed or reopen the ward stay.
        </p>
        <Field label="Reason" required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this admission needs reopening" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={reason.trim().length < 3} onClick={() => m.mutate()}>Reopen</Button>
        </div>
      </div>
    </Modal>
  )
}
