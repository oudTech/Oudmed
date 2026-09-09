'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui/kit'
import { can } from '@/lib/permissions'
import { encountersApi, ORDER_STATUS_META, ORDER_TYPE_LABEL, ABNORMAL_FLAGS } from '@/lib/encounters'
import { EmptyState } from '@/components/onboarding'

const dt = (iso: string) => new Date(iso).toLocaleString('en-GB')

type Order = {
  id: string
  orderType: string
  name: string
  status: string
  priority: string | null
  clinicalNote: string | null
  orderedAt: string
  orderedByName: string | null
  patient: { id: string; patientNumber: string; firstName: string; lastName: string }
  resultValue: string | null
  resultUnit: string | null
  referenceRange: string | null
  abnormalFlag: string | null
  resultNote: string | null
}

export default function LabPage() {
  const { data: session } = useSession()
  const canResult = can(session?.role, 'order:result')
  const [status, setStatus] = useState('open')
  const [active, setActive] = useState<Order | null>(null)

  const q = useQuery({
    queryKey: ['lab-worklist', status],
    queryFn: () => encountersApi.labWorklist(status === 'open' ? undefined : status),
    enabled: canResult,
  })

  if (!canResult) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Laboratory</h1>
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6">
          The laboratory worklist is available to lab staff, doctors, and hospital admins.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="px-8 pt-7 pb-4 flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-900">Laboratory</h1>
        <p className="text-sm text-gray-400 mt-1">Investigations awaiting collection and results.</p>
      </div>

      <div data-tour="lab-worklist" className="px-8 flex gap-2 flex-shrink-0 border-b border-[#D6DEE8] pb-3">
        {[
          ['open', 'Open'],
          ['ORDERED', 'Ordered'],
          ['IN_PROGRESS', 'In progress'],
          ['RESULTED', 'Resulted'],
        ].map(([v, label]) => (
          <button
            key={v}
            onClick={() => setStatus(v)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${status === v ? 'bg-blue-50 text-primary' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        {!q.data ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : q.data.length === 0 ? (
          <EmptyState
            compact
            title={status === 'open' ? 'No investigations waiting' : 'Nothing in this view'}
            description={
              status === 'open'
                ? 'When a doctor orders a test or scan it lands here. Results you enter flow straight back to them.'
                : 'Try the Open tab, or a different status.'
            }
          />
        ) : (
          <div className="border border-gray-100 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  {['Ordered', 'Patient', 'Test', 'Type', 'Priority', 'Status', ''].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(q.data as Order[]).map((o) => {
                  const om = ORDER_STATUS_META[o.status]
                  return (
                    <tr key={o.id} className="border-t border-gray-100">
                      <td className="px-3 py-2.5 text-gray-500">{dt(o.orderedAt)}</td>
                      <td className="px-3 py-2.5">
                        {o.patient.firstName} {o.patient.lastName}
                        <span className="text-gray-400 text-xs ml-1">{o.patient.patientNumber}</span>
                      </td>
                      <td className="px-3 py-2.5 font-medium text-gray-900">{o.name}</td>
                      <td className="px-3 py-2.5 text-gray-500">{ORDER_TYPE_LABEL[o.orderType]}</td>
                      <td className={`px-3 py-2.5 ${o.priority && o.priority !== 'Routine' ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                        {o.priority ?? 'Routine'}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: om.color, backgroundColor: om.bg }}>
                          {om.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {canResult && o.status !== 'CANCELLED' && (
                          <button className="text-sm font-semibold text-primary hover:underline" onClick={() => setActive(o)}>
                            {o.status === 'RESULTED' ? 'Edit result' : 'Enter result'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ResultModal order={active} open={!!active} onClose={() => setActive(null)} />
    </div>
  )
}

function ResultModal({ order, open, onClose }: { order: Order | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({
    resultValue: '',
    resultUnit: '',
    referenceRange: '',
    abnormalFlag: 'Normal',
    resultNote: '',
  })

  // seed the form when a new order opens
  const [seededFor, setSeededFor] = useState<string | null>(null)
  if (order && seededFor !== order.id) {
    setSeededFor(order.id)
    setF({
      resultValue: order.resultValue ?? '',
      resultUnit: order.resultUnit ?? '',
      referenceRange: order.referenceRange ?? '',
      abnormalFlag: order.abnormalFlag ?? 'Normal',
      resultNote: order.resultNote ?? '',
    })
  }

  const m = useMutation({
    mutationFn: () => encountersApi.updateOrder(order!.id, f),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab-worklist'] })
      onClose()
    },
  })
  const progress = useMutation({
    mutationFn: () => encountersApi.updateOrder(order!.id, { status: 'IN_PROGRESS' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lab-worklist'] })
      onClose()
    },
  })

  if (!order) return null
  return (
    <Modal open={open} onClose={onClose} title={`${order.name} · ${order.patient.firstName} ${order.patient.lastName}`} width={480} align="center">
      <div className="space-y-3">
        {order.clinicalNote && (
          <p className="text-sm text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
            <span className="font-medium text-gray-700">Clinical details: </span>{order.clinicalNote}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Result value" required>
            <Input value={f.resultValue} onChange={(e) => setF({ ...f, resultValue: e.target.value })} placeholder="e.g. 10.4 or Positive" />
          </Field>
          <Field label="Unit">
            <Input value={f.resultUnit} onChange={(e) => setF({ ...f, resultUnit: e.target.value })} placeholder="g/dL" />
          </Field>
          <Field label="Reference range">
            <Input value={f.referenceRange} onChange={(e) => setF({ ...f, referenceRange: e.target.value })} placeholder="12 - 16" />
          </Field>
          <Field label="Flag">
            <Select value={f.abnormalFlag} onChange={(e) => setF({ ...f, abnormalFlag: e.target.value })}>
              {ABNORMAL_FLAGS.map((x) => <option key={x}>{x}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Interpretation / note">
          <Textarea rows={3} value={f.resultNote} onChange={(e) => setF({ ...f, resultNote: e.target.value })} />
        </Field>
        {m.isError && <p className="text-sm text-red-600">Could not save the result.</p>}
        <div className="flex justify-between gap-2">
          {order.status === 'ORDERED' ? (
            <Button variant="secondary" loading={progress.isPending} onClick={() => progress.mutate()}>
              Mark in progress
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button loading={m.isPending} disabled={f.resultValue.trim().length < 1} onClick={() => m.mutate()}>
              Save result
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
