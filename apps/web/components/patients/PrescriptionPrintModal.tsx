'use client'
import { useQuery } from '@tanstack/react-query'
import { Button, Modal } from '@/components/ui/kit'
import { settingsApi } from '@/lib/settings'
import type { PrescriptionDTO } from '@oudhealth/contracts'

const dt = (iso: string) => new Date(iso).toLocaleDateString('en-GB')

export function PrescriptionPrintModal({
  prescription,
  patient,
  open,
  onClose,
}: {
  prescription: PrescriptionDTO | null
  patient: { name: string; patientNumber: string; age: number | null; gender: string | null }
  open: boolean
  onClose: () => void
}) {
  const settings = useQuery({ queryKey: ['hospital-settings'], queryFn: settingsApi.get, enabled: open })
  const s = settings.data
  const rx = prescription

  return (
    <Modal open={open} onClose={onClose} title="Print prescription" width={820} align="center">
      {!rx || !s ? (
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
                <p className="font-semibold text-gray-700 text-sm">Prescription</p>
                <p>Date: {dt(rx.prescribedAt)}</p>
              </div>
            </div>

            <div className="flex justify-between text-sm mb-5 border-b border-dashed border-gray-300 pb-3">
              <div>
                <p className="font-semibold">{patient.name}</p>
                <p className="text-gray-500 text-xs">{patient.patientNumber}</p>
              </div>
              <div className="text-right text-xs text-gray-500">
                {patient.age != null && <p>Age: {patient.age} years</p>}
                {patient.gender && <p>Sex: {patient.gender}</p>}
              </div>
            </div>

            <p className="text-3xl italic font-serif text-gray-700 mb-2">&#8478;</p>
            <ol className="space-y-4 mb-10">
              {rx.items.map((it, i) => (
                <li key={it.id} className="text-sm">
                  <p className="font-semibold">
                    {i + 1}. {it.drugName}
                    {it.dosageForm ? ` (${it.dosageForm})` : ''}
                    {it.strengthConc ? ` ${it.strengthConc}` : ''}
                  </p>
                  <p className="text-gray-600 ml-4">
                    {[it.amountPerUse, it.route, it.frequency, it.foodRelation].filter(Boolean).join(' · ') || '-'}
                    {it.durationNumber ? ` for ${it.durationNumber} ${(it.durationType ?? 'days').toLowerCase()}` : ''}
                  </p>
                  {it.instructions && <p className="text-gray-500 ml-4 text-xs italic">{it.instructions}</p>}
                </li>
              ))}
            </ol>
            {rx.notes && (
              <p className="text-xs text-gray-500 mb-8">
                <span className="font-medium text-gray-700">Notes: </span>{rx.notes}
              </p>
            )}

            <div className="flex justify-between items-end mt-auto pt-4 border-t border-gray-200 text-xs text-gray-500">
              <p>Prescribed by: {rx.prescribedByName ?? '-'}</p>
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
