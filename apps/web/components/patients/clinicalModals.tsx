'use client'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ComplaintDTO } from '@oudhealth/contracts'
import { Modal, Field, Input, Select, Textarea, Button } from '@/components/ui/kit'
import {
  patientsApi,
  titleCase,
  ATTENDANCE_TYPES,
  DIAGNOSIS_CERTAINTY,
  DRUG_ROUTES,
  DOSAGE_FORMS,
  DRUG_FREQUENCIES,
  FOOD_RELATIONS,
  DURATION_TYPES,
  AVPU_OPTIONS,
  PAYMENT_METHODS,
} from '@/lib/patients'
import { drugsApi } from '@/lib/pharmacy'
import { newIdempotencyKey } from '@/lib/billing'

function useAdd(patientId: string, key: string, fn: (data: any) => Promise<any>, onDone: () => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [key, patientId] })
      qc.invalidateQueries({ queryKey: ['patient', patientId] })
      onDone()
    },
  })
}

/* ────────────── Complaint detail (row click) ────────────── */
export function ComplaintDetailModal({
  patientId,
  complaint,
  open,
  onClose,
  canEdit,
}: {
  patientId: string
  complaint: ComplaintDTO | null
  open: boolean
  onClose: () => void
  canEdit: boolean
}) {
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      patientsApi.updateComplaint(patientId, complaint!.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['complaints', patientId] })
      qc.invalidateQueries({ queryKey: ['patient', patientId] })
      onClose()
    },
  })
  if (!complaint) return null
  return (
    <Modal open={open} onClose={onClose} title="Complaint" width={480} align="center">
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Complaint</p>
          <p className="text-sm text-gray-900">{complaint.description}</p>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Onset</p>
            <p className="text-gray-800">{complaint.onsetNote || '-'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Severity</p>
            <p className="text-gray-800">{complaint.severity || '-'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Recorded by</p>
            <p className="text-gray-800">{complaint.recordedByName || '-'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Recorded on</p>
            <p className="text-gray-800">{new Date(complaint.recordedAt).toLocaleString('en-GB')}</p>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Status</p>
          <p className="text-gray-800">{titleCase(complaint.status)}</p>
        </div>
        {m.isError && <p className="text-sm text-red-600">Could not update.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {canEdit && complaint.status === 'OPEN' && (
            <Button loading={m.isPending} onClick={() => m.mutate({ status: 'RESOLVED' })}>
              Mark resolved
            </Button>
          )}
          {canEdit && complaint.status === 'RESOLVED' && (
            <Button variant="secondary" loading={m.isPending} onClick={() => m.mutate({ status: 'OPEN' })}>
              Reopen
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

/* Kept for compatibility; the Complaints tab now adds inline. */
export function AddComplaintModal({ patientId, open, onClose }: { patientId: string; open: boolean; onClose: () => void }) {
  const [d, setD] = useState({ description: '', severity: '', onsetNote: '' })
  const m = useAdd(patientId, 'complaints', (data) => patientsApi.addComplaint(patientId, data), onClose)
  return (
    <Modal open={open} onClose={onClose} title="Record complaint" width={460} align="center">
      <div className="space-y-3">
        <Field label="Complaint" required>
          <Textarea rows={2} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="Presenting complaint" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Severity">
            <Select value={d.severity} onChange={(e) => setD({ ...d, severity: e.target.value })}>
              <option value="">-</option><option>Mild</option><option>Moderate</option><option>Severe</option>
            </Select>
          </Field>
          <Field label="Onset">
            <Input value={d.onsetNote} onChange={(e) => setD({ ...d, onsetNote: e.target.value })} placeholder="e.g. 3 days ago" />
          </Field>
        </div>
        {m.isError && <p className="text-sm text-red-600">Could not save.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={d.description.trim().length < 2} onClick={() => m.mutate({ description: d.description.trim(), severity: d.severity || undefined, onsetNote: d.onsetNote || undefined })}>Save</Button>
        </div>
      </div>
    </Modal>
  )
}

/* ────────────── Diagnosis ────────────── */
export function AddDiagnosisModal({ patientId, visitId, open, onClose }: { patientId: string; visitId?: string; open: boolean; onClose: () => void }) {
  const [d, setD] = useState({
    attendanceType: 'Consultation',
    certainty: 'PROVISIONAL',
    description: '',
    code: '',
    notes: '',
  })
  const m = useAdd(patientId, 'diagnoses', (data) => patientsApi.addDiagnosis(patientId, { ...data, visitId }), onClose)
  return (
    <Modal open={open} onClose={onClose} title="Add diagnosis" width={480} align="center">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Attendance">
            <Select value={d.attendanceType} onChange={(e) => setD({ ...d, attendanceType: e.target.value })}>
              {ATTENDANCE_TYPES.map((a) => <option key={a}>{a}</option>)}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={d.certainty} onChange={(e) => setD({ ...d, certainty: e.target.value })}>
              {DIAGNOSIS_CERTAINTY.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Diagnosis" required>
          <Input value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="e.g. Tension-type headache" />
        </Field>
        <Field label="ICD-10 code">
          <Input value={d.code} onChange={(e) => setD({ ...d, code: e.target.value })} placeholder="Optional" />
        </Field>
        <Field label="Comments">
          <Textarea rows={3} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
        </Field>
        {m.isError && <p className="text-sm text-red-600">Could not save.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={m.isPending}
            disabled={d.description.trim().length < 2}
            onClick={() =>
              m.mutate({
                attendanceType: d.attendanceType,
                certainty: d.certainty,
                description: d.description.trim(),
                code: d.code || undefined,
                notes: d.notes || undefined,
              })
            }
          >
            Add diagnosis
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ────────────── Vital signs ────────────── */
export function AddVitalsModal({ patientId, visitId, open, onClose }: { patientId: string; visitId?: string; open: boolean; onClose: () => void }) {
  const [d, setD] = useState<Record<string, string>>({ avpu: '' })
  const s = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value })
  const m = useAdd(patientId, 'vitals', (data) => patientsApi.addVitals(patientId, { ...data, visitId }), onClose)
  const num = (v?: string) => (v ? Number(v) : undefined)
  return (
    <Modal open={open} onClose={onClose} title="Record vital signs" width={560} align="center">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Temp (°C)"><Input type="number" step="0.1" value={d.temperatureC ?? ''} onChange={s('temperatureC')} /></Field>
        <Field label="Pulse (bpm)"><Input type="number" value={d.pulseBpm ?? ''} onChange={s('pulseBpm')} /></Field>
        <Field label="Resp rate"><Input type="number" value={d.respiratoryRate ?? ''} onChange={s('respiratoryRate')} /></Field>
        <Field label="Systolic BP"><Input type="number" value={d.systolicBp ?? ''} onChange={s('systolicBp')} /></Field>
        <Field label="Diastolic BP"><Input type="number" value={d.diastolicBp ?? ''} onChange={s('diastolicBp')} /></Field>
        <Field label="SpO₂ (%)"><Input type="number" value={d.spo2 ?? ''} onChange={s('spo2')} /></Field>
        <Field label="Weight (kg)"><Input type="number" step="0.1" value={d.weightKg ?? ''} onChange={s('weightKg')} /></Field>
        <Field label="Height (cm)"><Input type="number" value={d.heightCm ?? ''} onChange={s('heightCm')} /></Field>
        <Field label="Blood sugar (mmol/L)"><Input type="number" step="0.1" value={d.bloodGlucose ?? ''} onChange={s('bloodGlucose')} /></Field>
        <Field label="Urine output (mL)"><Input type="number" value={d.urineOutputMl ?? ''} onChange={s('urineOutputMl')} /></Field>
        <Field label="AVPU">
          <Select value={d.avpu ?? ''} onChange={s('avpu')}>
            <option value="">-</option>
            {AVPU_OPTIONS.map((a) => <option key={a}>{a}</option>)}
          </Select>
        </Field>
        <Field label="Pain (0-10)"><Input type="number" value={d.painScore ?? ''} onChange={s('painScore')} /></Field>
      </div>
      <div className="mt-3">
        <Field label="Comments">
          <Textarea rows={2} value={d.notes ?? ''} onChange={(e) => setD({ ...d, notes: e.target.value })} />
        </Field>
      </div>
      {m.isError && <p className="text-sm text-red-600 mt-2">Could not save.</p>}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          loading={m.isPending}
          onClick={() =>
            m.mutate({
              temperatureC: num(d.temperatureC), pulseBpm: num(d.pulseBpm), respiratoryRate: num(d.respiratoryRate),
              systolicBp: num(d.systolicBp), diastolicBp: num(d.diastolicBp), spo2: num(d.spo2),
              weightKg: num(d.weightKg), heightCm: num(d.heightCm), bloodGlucose: num(d.bloodGlucose),
              urineOutputMl: num(d.urineOutputMl), avpu: d.avpu || undefined, painScore: num(d.painScore),
              notes: d.notes || undefined,
            })
          }
        >
          Save
        </Button>
      </div>
    </Modal>
  )
}

/* ────────────── Prescription ("Medicine Prescription") ────────────── */
type RxItem = {
  drugId?: string
  drugName: string
  route: string
  dosageForm: string
  strengthConc: string
  amountPerUse: string
  frequency: string
  foodRelation: string
  durationType: string
  durationNumber: string
  instructions: string
}
const EMPTY_ITEM: RxItem = {
  drugId: undefined,
  drugName: '', route: 'PO (Oral)', dosageForm: 'Tablet', strengthConc: '', amountPerUse: '',
  frequency: 'BD (twice a day)', foodRelation: 'After food', durationType: 'Days', durationNumber: '', instructions: '',
}

/** Medicine field with catalogue autocomplete; free text still allowed (off-formulary). */
function MedicineInput({
  value,
  onPick,
  onType,
}: {
  value: string
  onPick: (d: { id: string; name: string; form: string | null; strength: string | null }) => void
  onType: (v: string) => void
}) {
  const [q, setQ] = useState(value)
  const [open, setOpen] = useState(false)
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250)
    return () => clearTimeout(t)
  }, [q])
  const results = useQuery({
    queryKey: ['drug-search', debounced],
    queryFn: () => drugsApi.search(debounced),
    enabled: open && debounced.trim().length >= 2,
  })
  return (
    <div className="relative">
      <Input
        value={q}
        onChange={(e) => { setQ(e.target.value); onType(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="e.g. Paracetamol"
      />
      {open && (results.data?.length ?? 0) > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {results.data!.map((d) => (
            <button
              key={d.id}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between"
              onMouseDown={(e) => {
                e.preventDefault()
                setQ(d.name)
                onPick(d)
                setOpen(false)
              }}
            >
              <span>
                {d.name}
                {d.strength && <span className="text-gray-400"> {d.strength}</span>}
              </span>
              <span className={`text-xs ${d.quantityOnHand <= 0 ? 'text-red-500' : 'text-gray-400'}`}>
                {d.quantityOnHand} on hand · ₦{Number(d.sellPrice).toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function AddPrescriptionModal({ patientId, visitId, open, onClose }: { patientId: string; visitId?: string; open: boolean; onClose: () => void }) {
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<RxItem[]>([])
  const [draft, setDraft] = useState<RxItem>(EMPTY_ITEM)
  const m = useAdd(patientId, 'prescriptions', (data) => patientsApi.addPrescription(patientId, { ...data, visitId }), () => {
    setItems([]); setDraft(EMPTY_ITEM); setNotes(''); onClose()
  })
  const set = (k: keyof RxItem, v: string) => setDraft((it) => ({ ...it, [k]: v }))
  const addDraft = () => {
    if (!draft.drugName.trim()) return
    setItems((a) => [...a, draft])
    setDraft(EMPTY_ITEM)
  }
  const toPayload = (it: RxItem) => ({
    drugId: it.drugId || undefined,
    drugName: it.drugName.trim(),
    route: it.route || undefined,
    dosageForm: it.dosageForm || undefined,
    strengthConc: it.strengthConc || undefined,
    amountPerUse: it.amountPerUse || undefined,
    frequency: it.frequency || undefined,
    foodRelation: it.foodRelation || undefined,
    durationType: it.durationType || undefined,
    durationNumber: it.durationNumber ? Number(it.durationNumber) : undefined,
    instructions: it.instructions || undefined,
  })
  const all = draft.drugName.trim() ? [...items, draft] : items

  return (
    <Modal open={open} onClose={onClose} title="Medicine prescription" width={640} align="center">
      <div className="space-y-4">
        {items.length > 0 && (
          <ul className="space-y-1">
            {items.map((it, i) => (
              <li key={i} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                <span className="text-gray-800">
                  <span className="font-medium">{it.drugName}</span>
                  {it.strengthConc && ` ${it.strengthConc}`}
                  {it.frequency && ` · ${it.frequency}`}
                  {it.durationNumber && ` · ${it.durationNumber} ${it.durationType.toLowerCase()}`}
                </span>
                <button className="text-gray-400 hover:text-red-500" onClick={() => setItems((a) => a.filter((_, j) => j !== i))}>✕</button>
              </li>
            ))}
          </ul>
        )}

        <div className="rounded-xl border border-gray-100 p-4 space-y-3">
          <Field label="Medicine" required>
            <MedicineInput
              value={draft.drugName}
              onType={(v) => setDraft((it) => ({ ...it, drugName: v, drugId: undefined }))}
              onPick={(dg) =>
                setDraft((it) => ({
                  ...it,
                  drugId: dg.id,
                  drugName: dg.name,
                  dosageForm: dg.form || it.dosageForm,
                  strengthConc: dg.strength || it.strengthConc,
                }))
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Route">
              <Select value={draft.route} onChange={(e) => set('route', e.target.value)}>
                {DRUG_ROUTES.map((r) => <option key={r}>{r}</option>)}
              </Select>
            </Field>
            <Field label="Dosage form">
              <Select value={draft.dosageForm} onChange={(e) => set('dosageForm', e.target.value)}>
                {DOSAGE_FORMS.map((f) => <option key={f}>{f}</option>)}
              </Select>
            </Field>
            <Field label="Strength / concentration">
              <Input value={draft.strengthConc} onChange={(e) => set('strengthConc', e.target.value)} placeholder="e.g. 500 mg" />
            </Field>
            <Field label="Amount per use">
              <Input value={draft.amountPerUse} onChange={(e) => set('amountPerUse', e.target.value)} placeholder="e.g. 2 tablets" />
            </Field>
            <Field label="Frequency">
              <Select value={draft.frequency} onChange={(e) => set('frequency', e.target.value)}>
                {DRUG_FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
              </Select>
            </Field>
            <Field label="Food relation">
              <Select value={draft.foodRelation} onChange={(e) => set('foodRelation', e.target.value)}>
                {FOOD_RELATIONS.map((f) => <option key={f}>{f}</option>)}
              </Select>
            </Field>
            <Field label="Duration">
              <Input type="number" value={draft.durationNumber} onChange={(e) => set('durationNumber', e.target.value)} placeholder="e.g. 5" />
            </Field>
            <Field label="Duration unit">
              <Select value={draft.durationType} onChange={(e) => set('durationType', e.target.value)}>
                {DURATION_TYPES.map((f) => <option key={f}>{f}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Instructions">
            <Textarea rows={2} value={draft.instructions} onChange={(e) => set('instructions', e.target.value)} placeholder="Directions for the patient" />
          </Field>
          <button
            onClick={addDraft}
            disabled={!draft.drugName.trim()}
            className="text-sm font-medium text-[#0A89D3] hover:underline disabled:text-gray-300"
          >
            + Add another medicine
          </button>
        </div>

        <Field label="Prescription notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {m.isError && <p className="text-sm text-red-600">Could not save.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={m.isPending}
            disabled={all.length === 0}
            onClick={() => m.mutate({ notes: notes || undefined, items: all.map(toPayload) })}
          >
            Save prescription
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ────────────── Documents ────────────── */
export function AddDocumentModal({ patientId, open, onClose }: { patientId: string; open: boolean; onClose: () => void }) {
  const [d, setD] = useState({ category: 'LAB_RESULT', title: '', note: '' })
  const [file, setFile] = useState<File | null>(null)
  const m = useAdd(
    patientId,
    'documents',
    () => patientsApi.addDocument(patientId, { ...d, file: file! }),
    () => { setD({ category: 'LAB_RESULT', title: '', note: '' }); setFile(null); onClose() },
  )
  return (
    <Modal open={open} onClose={onClose} title="Add document" width={440} align="center">
      <div className="space-y-3">
        <Field label="File" required>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              setFile(f)
              if (f && !d.title.trim()) setD((x) => ({ ...x, title: f.name.replace(/\.[^.]+$/, '') }))
            }}
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm"
          />
          <p className="text-xs text-gray-400 mt-1">PNG, JPEG, WebP or PDF, up to 20 MB.</p>
        </Field>
        <Field label="Category">
          <Select value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })}>
            {['IDENTIFICATION', 'LAB_RESULT', 'IMAGING', 'REFERRAL', 'CONSENT', 'INSURANCE_CARD', 'DISCHARGE_SUMMARY', 'OTHER'].map((c) => (
              <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
            ))}
          </Select>
        </Field>
        <Field label="Title" required><Input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} /></Field>
        <Field label="Note"><Textarea rows={2} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} /></Field>
        {m.isError && <p className="text-sm text-red-600">{(m.error as any)?.response?.data?.message ?? 'Could not save.'}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={!file || d.title.trim().length < 2} onClick={() => m.mutate({})}>Upload</Button>
        </div>
      </div>
    </Modal>
  )
}

/* ────────────── Pay invoice ────────────── */
export function PayInvoiceModal({
  patientId,
  invoice,
  open,
  onClose,
}: {
  patientId: string
  invoice: { id: string; invoiceNumber: string; balanceDue: string } | null
  open: boolean
  onClose: () => void
}) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('CASH')
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey())
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: (data: { amount: number; method: string }) =>
      patientsApi.payInvoice(patientId, invoice!.id, { ...data, idempotencyKey: idemKey }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pt-invoices', patientId] })
      qc.invalidateQueries({ queryKey: ['patient', patientId] })
      setAmount('')
      setIdemKey(newIdempotencyKey())
      onClose()
    },
  })
  if (!invoice) return null
  const balance = Number(invoice.balanceDue)
  return (
    <Modal open={open} onClose={onClose} title={`Record payment · ${invoice.invoiceNumber}`} width={420} align="center">
      <div className="space-y-3">
        <p className="text-sm text-gray-500">
          Balance due <span className="font-semibold text-gray-900">₦{balance.toLocaleString()}</span>
        </p>
        <Field label="Amount" required>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(balance)} />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}
          </Select>
        </Field>
        <button
          className="text-sm text-[#0A89D3] hover:underline"
          onClick={() => setAmount(String(balance))}
        >
          Pay full balance
        </button>
        {m.isError && <p className="text-sm text-red-600">Could not record payment.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={m.isPending}
            disabled={!amount || Number(amount) <= 0}
            onClick={() => m.mutate({ amount: Number(amount), method })}
          >
            Record payment
          </Button>
        </div>
      </div>
    </Modal>
  )
}
