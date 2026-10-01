'use client'
import { useQuery } from '@tanstack/react-query'
import { Button, Modal } from '@/components/ui/kit'
import { settingsApi } from '@/lib/settings'

const dt = (iso: string) => new Date(iso).toLocaleString('en-GB')

/** Minimal shape both the lab worklist and the patient chart's Investigations
 * tab can supply - the two call sites' own order types differ slightly. */
export interface PrintableLabOrder {
  name: string
  orderType: string
  resultValue: string | null
  resultUnit: string | null
  referenceRange: string | null
  abnormalFlag: string | null
  resultNote: string | null
  orderedByName: string | null
  orderedAt: string
  resultedByName?: string | null
  resultedAt?: string | null
}

export function LabReportPrintModal({
  order,
  patient,
  open,
  onClose,
}: {
  order: PrintableLabOrder | null
  patient: { name: string; patientNumber: string; age: number | null; gender: string | null }
  open: boolean
  onClose: () => void
}) {
  const settings = useQuery({ queryKey: ['hospital-settings'], queryFn: settingsApi.get, enabled: open })
  const s = settings.data
  const o = order

  return (
    <Modal open={open} onClose={onClose} title="Print lab report" width={820} align="center">
      {!o || !s ? (
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
                <p className="font-semibold text-gray-700 text-sm">
                  {o.orderType === 'IMAGING' ? 'Imaging report' : 'Laboratory report'}
                </p>
                <p>Reported: {o.resultedAt ? dt(o.resultedAt) : '-'}</p>
              </div>
            </div>

            <div className="flex justify-between text-sm mb-6 border-b border-dashed border-gray-300 pb-3">
              <div>
                <p className="font-semibold">{patient.name}</p>
                <p className="text-gray-500 text-xs">{patient.patientNumber}</p>
              </div>
              <div className="text-right text-xs text-gray-500">
                {patient.age != null && <p>Age: {patient.age} years</p>}
                {patient.gender && <p>Sex: {patient.gender}</p>}
              </div>
            </div>

            <table className="w-full text-sm mb-6">
              <thead className="text-left text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="py-2 font-medium">Test</th>
                  <th className="py-2 font-medium">Result</th>
                  <th className="py-2 font-medium">Reference range</th>
                  <th className="py-2 font-medium">Flag</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="py-2.5 font-medium">{o.name}</td>
                  <td className="py-2.5">{o.resultValue}{o.resultUnit ? ` ${o.resultUnit}` : ''}</td>
                  <td className="py-2.5 text-gray-500">{o.referenceRange ?? '-'}</td>
                  <td className={`py-2.5 ${o.abnormalFlag && o.abnormalFlag !== 'Normal' ? 'text-red-600 font-semibold' : ''}`}>
                    {o.abnormalFlag ?? '-'}
                  </td>
                </tr>
              </tbody>
            </table>

            {o.resultNote && (
              <p className="text-sm mb-8">
                <span className="font-medium text-gray-700">Interpretation: </span>
                <span className="text-gray-600">{o.resultNote}</span>
              </p>
            )}

            <div className="flex justify-between items-end mt-auto pt-4 border-t border-gray-200 text-xs text-gray-500">
              <div>
                <p>Ordered by: {o.orderedByName ?? '-'} ({dt(o.orderedAt)})</p>
                <p>Reported by: {o.resultedByName ?? '-'}</p>
              </div>
              <div className="text-center">
                <div className="border-t border-gray-400 w-40 pt-1">Signature</div>
              </div>
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
