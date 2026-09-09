'use client'
import { useQuery } from '@tanstack/react-query'
import { Button, Modal } from '@/components/ui/kit'
import { billingApi, naira, PAYER_TYPES } from '@/lib/billing'

const dt = (iso: string) => new Date(iso).toLocaleString('en-GB')

export function ReceiptView({
  paymentId,
  open,
  onClose,
}: {
  paymentId: string | null
  open: boolean
  onClose: () => void
}) {
  const q = useQuery({
    queryKey: ['receipt', paymentId],
    queryFn: () => billingApi.receipt(paymentId!),
    enabled: open && !!paymentId,
  })
  const r = q.data
  const payerLabel = r ? PAYER_TYPES.find((p) => p.value === r.payerType)?.label ?? r.payerType : ''

  return (
    <Modal open={open} onClose={onClose} title="Receipt" width={460} align="center">
      {!r ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <>
          <div id="receipt-print" className="text-sm text-gray-800">
            <div className="text-center border-b border-dashed border-gray-300 pb-3 mb-3">
              {r.hospitalLogo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.hospitalLogo} alt="" className="mx-auto mb-1 h-10 object-contain" />
              )}
              <p className="text-lg font-bold">{r.hospitalName}</p>
              {r.hospitalAddress && <p className="text-[11px] text-gray-500">{r.hospitalAddress}</p>}
              <p className="text-[11px] text-gray-500">
                {[r.hospitalPhone, r.hospitalRcNumber && `RC ${r.hospitalRcNumber}`, r.hospitalTaxId && `TIN ${r.hospitalTaxId}`]
                  .filter(Boolean)
                  .join('  ·  ')}
              </p>
              <p className="text-xs text-gray-500 mt-1">Payment receipt</p>
            </div>
            <Row label="Receipt no." value={r.receiptNumber} mono />
            <Row label="Date" value={dt(r.paidAt)} />
            <Row label="Patient" value={r.patient ? `${r.patient.name} (${r.patient.patientNumber})` : '-'} />
            <Row label="Invoice" value={r.invoiceNumber} mono />
            <Row label="Cashier" value={r.cashierName ?? '-'} />

            <div className="border-t border-dashed border-gray-300 my-3" />
            <table className="w-full text-xs">
              <tbody>
                {r.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="py-0.5">{l.description}{l.quantity > 1 ? ` ×${l.quantity}` : ''}</td>
                    <td className="py-0.5 text-right">{naira(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-dashed border-gray-300 my-3" />

            <Row label="Invoice total" value={naira(r.invoiceTotal)} />
            <div className="flex justify-between py-1 font-bold text-base">
              <span>Amount paid</span>
              <span>{naira(r.amount)}</span>
            </div>
            <Row label="Method" value={`${r.method}${r.reference ? ` · ${r.reference}` : ''}`} />
            <Row label="Payer" value={`${payerLabel}${r.payerName ? ` · ${r.payerName}` : ''}`} />
            <Row label="Balance after" value={naira(r.balanceAfter)} />

            <p className="text-center text-[11px] text-gray-400 mt-4 whitespace-pre-line">
              {r.documentFooter || 'Thank you.'}
            </p>
          </div>

          <div className="flex justify-end gap-2 mt-4 receipt-actions">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button onClick={() => window.print()}>Print</Button>
          </div>
        </>
      )}
    </Modal>
  )
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-gray-500">{label}</span>
      <span className={mono ? 'font-mono' : ''}>{value ?? '-'}</span>
    </div>
  )
}
