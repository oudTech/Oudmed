'use client'
import { useQuery } from '@tanstack/react-query'
import type { AdmissionBillDTO } from '@oudhealth/contracts'
import { Button, Modal } from '@/components/ui/kit'
import { settingsApi } from '@/lib/settings'
import { naira } from '@/lib/billing'

const dt = (iso: string) => new Date(iso).toLocaleString('en-GB')

/** The interim (still-admitted) or final (discharged) bill for one admission -
 * every invoice's lines, plus the deposit ledger and the running balance. */
export function AdmissionBillPrintModal({
  bill,
  patient,
  open,
  onClose,
}: {
  bill: AdmissionBillDTO | null
  patient: { name: string; patientNumber: string }
  open: boolean
  onClose: () => void
}) {
  const settings = useQuery({ queryKey: ['hospital-settings'], queryFn: settingsApi.get, enabled: open })
  const s = settings.data
  const b = bill
  const interim = b?.admission.status === 'ADMITTED'

  return (
    <Modal open={open} onClose={onClose} title={interim ? 'Interim bill' : 'Final bill'} width={820} align="center">
      {!b || !s ? (
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
                  {(s.phone || s.contactEmail) && (
                    <p className="text-xs text-gray-500">{[s.phone, s.contactEmail].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
              </div>
              <div className="text-right text-xs text-gray-500">
                <p className="font-semibold text-gray-700 text-sm">{interim ? 'Interim bill' : 'Final bill'}</p>
                <p>{b.admission.admissionNumber}</p>
                <p>Printed: {dt(new Date().toISOString())}</p>
              </div>
            </div>

            <div className="flex justify-between text-sm mb-4 border-b border-dashed border-gray-300 pb-3">
              <div>
                <p className="font-semibold">{patient.name}</p>
                <p className="text-gray-500 text-xs">{patient.patientNumber}</p>
              </div>
              <div className="text-right text-xs text-gray-500">
                <p>Ward / bed: {b.admission.ward?.name ?? '-'} / {b.admission.bed?.label ?? '-'}</p>
                <p>Admitted: {dt(b.admission.admittedAt)}</p>
                {b.admission.dischargedAt && <p>Discharged: {dt(b.admission.dischargedAt)}</p>}
              </div>
            </div>

            {b.invoices.map((inv) => (
              <div key={inv.id} className="mb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  {inv.invoiceNumber}{inv.isSupplementary ? ' (supplementary)' : ''}
                </p>
                <table className="w-full text-sm">
                  <thead className="text-left text-gray-500 border-b border-gray-200">
                    <tr>
                      <th className="py-1.5 font-medium">Description</th>
                      <th className="py-1.5 font-medium text-right">Qty</th>
                      <th className="py-1.5 font-medium text-right">Unit price</th>
                      <th className="py-1.5 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.lines.map((l) => (
                      <tr key={l.id} className="border-b border-gray-100">
                        <td className="py-1.5">{l.description}</td>
                        <td className="py-1.5 text-right">{l.quantity}</td>
                        <td className="py-1.5 text-right">{naira(l.unitPrice)}</td>
                        <td className="py-1.5 text-right">{naira(l.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} className="py-1.5 text-right font-medium">Invoice total</td>
                      <td className="py-1.5 text-right font-semibold">{naira(inv.totalAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ))}

            {b.deposits.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Deposits</p>
                <table className="w-full text-sm">
                  <tbody>
                    {b.deposits.map((d) => (
                      <tr key={d.id} className="border-b border-gray-100">
                        <td className="py-1.5">
                          Deposit{d.refundedAmount ? ' (partially refunded)' : ''} · {d.method} · {d.receiptNumber ?? '-'} · {dt(d.receivedAt)}
                        </td>
                        <td className="py-1.5 text-right">{naira(d.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="border-t-2 border-gray-800 pt-3 ml-auto w-72 text-sm">
              <Row label="Total charged" value={naira(b.totalCharged)} />
              <Row label="Total paid" value={naira(b.totalPaid)} />
              <Row label="Deposit held" value={naira(b.totalDeposited)} />
              <Row label="Balance" value={naira(b.balance)} bold />
            </div>

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

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${bold ? 'font-bold text-gray-900' : 'text-gray-600'}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
