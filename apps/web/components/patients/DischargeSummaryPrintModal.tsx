'use client'
import { useQuery } from '@tanstack/react-query'
import { Button, Modal } from '@/components/ui/kit'
import { settingsApi } from '@/lib/settings'
import { getDischargeSummary } from '@/lib/hospital'
import { naira } from '@/lib/billing'

const dt = (iso: string) => new Date(iso).toLocaleString('en-GB')

/** Assembled entirely from what was already recorded during the stay - no
 * new data collected (F1c, docs/features/F1-inpatient-billing.md section 8). */
export function DischargeSummaryPrintModal({
  admissionId,
  open,
  onClose,
}: {
  admissionId: string
  open: boolean
  onClose: () => void
}) {
  const settings = useQuery({ queryKey: ['hospital-settings'], queryFn: settingsApi.get, enabled: open })
  const summary = useQuery({ queryKey: ['discharge-summary', admissionId], queryFn: () => getDischargeSummary(admissionId), enabled: open })
  const s = settings.data
  const sum = summary.data

  return (
    <Modal open={open} onClose={onClose} title="Discharge summary" width={820} align="center">
      {!sum || !s ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <>
          <div className="print-a4 text-sm text-gray-900 bg-white">
            <div className="flex items-start justify-between border-b-2 border-gray-800 pb-3 mb-4">
              <div className="flex items-center gap-3">
                {s.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.logoUrl} alt="" className="h-12 object-contain" />
                )}
                <div>
                  <p className="text-lg font-bold">{s.name}</p>
                  {s.address && <p className="text-xs text-gray-500">{s.address}</p>}
                </div>
              </div>
              <div className="text-right text-xs text-gray-500">
                <p className="font-semibold text-gray-700 text-sm">Discharge summary</p>
                <p>{sum.admission.admissionNumber}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm mb-6 border-b border-dashed border-gray-300 pb-3">
              <div>
                <p className="font-semibold">{sum.admission.patient.firstName} {sum.admission.patient.lastName}</p>
                <p className="text-gray-500 text-xs">{sum.admission.patient.patientNumber}</p>
              </div>
              <div className="text-right text-xs text-gray-500">
                <p>Ward / bed: {sum.admission.ward?.name ?? '-'} / {sum.admission.bed?.label ?? '-'}</p>
                <p>Admitted: {dt(sum.admission.admittedAt)}</p>
                {sum.admission.dischargedAt && <p>Discharged: {dt(sum.admission.dischargedAt)}</p>}
                <p>Outcome: {sum.admission.status}</p>
              </div>
            </div>

            <Section title="Diagnoses">
              {sum.diagnoses.length === 0 ? <Empty /> : (
                <ul className="list-disc pl-5 space-y-0.5">
                  {sum.diagnoses.map((d: any) => <li key={d.id}>{d.description} ({d.certainty})</li>)}
                </ul>
              )}
            </Section>

            <Section title="Medications during the stay">
              {sum.prescriptions.length === 0 ? <Empty /> : (
                <ul className="list-disc pl-5 space-y-0.5">
                  {sum.prescriptions.map((rx: any) => (
                    <li key={rx.id}>{rx.items.map((it: any) => it.drugName).join(', ')}</li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Ward-round notes">
              {sum.notes.length === 0 ? <Empty /> : (
                <ul className="space-y-2">
                  {sum.notes.map((n: any) => (
                    <li key={n.id} className="border-b border-gray-100 pb-2">
                      <p className="text-xs text-gray-400 mb-0.5">{dt(n.createdAt)}</p>
                      {n.assessment && <p>{n.assessment}</p>}
                      {n.plan && <p className="text-gray-600">Plan: {n.plan}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <div className="border-t-2 border-gray-800 pt-3 mt-4 ml-auto w-72 text-sm">
              <Row label="Total charged" value={naira(sum.totalCharged)} />
              <Row label="Total paid" value={naira(sum.totalPaid)} />
              <Row label="Deposit held" value={naira(sum.totalDeposited)} />
              <Row label="Balance" value={naira(sum.balance)} bold />
            </div>

            {sum.admission.dischargeNotes && (
              <p className="text-sm mt-4"><span className="font-medium">Discharge notes: </span>{sum.admission.dischargeNotes}</p>
            )}
            {s.documentFooter && (
              <p className="text-center text-[11px] text-gray-400 mt-6 whitespace-pre-line">{s.documentFooter}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-4 print-hide">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button onClick={() => window.print()}>Print</Button>
          </div>
        </>
      )}
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{title}</p>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function Empty() {
  return <p className="text-gray-400">None recorded.</p>
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${bold ? 'font-bold text-gray-900' : 'text-gray-600'}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
