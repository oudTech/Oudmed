'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { AdmissionBillingOverviewDTO } from '@oudhealth/contracts'
import { Button } from '@/components/ui/kit'
import { can } from '@/lib/permissions'
import { naira } from '@/lib/billing'
import { getAdmissionsBillingOverview, getAdmissionBill } from '@/lib/hospital'
import { AddDepositModal, RefundDepositModal, ApplyDepositModal } from '@/components/patients/AdmissionDepositModals'
import { AdmissionBillPrintModal } from '@/components/patients/AdmissionBillPrintModal'
import { EmptyState } from '@/components/onboarding'

const d = (iso: string) => new Date(iso).toLocaleDateString('en-GB')

/** Billing-only route into the inpatient money workflow - deposits, apply-
 * to-bill, deposit refunds, and the interim bill - for roles that hold
 * `billing:manage`/`admission:deposit` but not `patient:read`, which is what
 * the full inpatient workspace (`/admissions/[id]`) is gated on. Accountant
 * is the case this exists for: they could already pay out a requested
 * refund (Refunds due) and pay an admission's invoice (Billing), but had no
 * way at all to take a deposit, apply one, request a refund, or see the
 * interim bill. */
export default function InpatientBillingPage() {
  const { data: session } = useSession()
  const role = session?.role
  const allowed = can(role, 'billing:manage')
  const canRefund = can(role, 'admission:deposit-refund')
  const qc = useQueryClient()

  const q = useQuery({ queryKey: ['admissions-billing-overview'], queryFn: getAdmissionsBillingOverview, enabled: allowed })
  const refresh = () => qc.invalidateQueries({ queryKey: ['admissions-billing-overview'] })

  const [depositFor, setDepositFor] = useState<string | null>(null)
  const [applyFor, setApplyFor] = useState<{ admissionId: string; max: number } | null>(null)
  const [refundingFor, setRefundingFor] = useState<{ admissionId: string; id: string; max: number } | null>(null)
  const [printingFor, setPrintingFor] = useState<AdmissionBillingOverviewDTO | null>(null)

  if (!allowed) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Inpatient billing</h1>
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6">
          You do not have access to billing.
        </p>
      </div>
    )
  }

  const totalDeposited = (q.data ?? []).reduce((s, a) => s + Number(a.totalDeposited), 0)
  const totalBalance = (q.data ?? []).reduce((s, a) => s + Math.max(0, Number(a.balance)), 0)

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="px-8 pt-7 pb-4 flex-shrink-0">
        <Link href="/billing" className="text-sm text-gray-400 hover:text-gray-700">&larr; Invoices</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Inpatient billing</h1>
        <p className="text-sm text-gray-400 mt-1">
          Every currently admitted patient's deposit and running balance.
          {q.data && q.data.length > 0 && (
            <span className="font-medium text-gray-600"> {naira(totalDeposited)} held, {naira(totalBalance)} owed.</span>
          )}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {!q.data ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : q.data.length === 0 ? (
          <EmptyState compact title="No one is admitted right now" description="Current admissions will show up here with their deposit and balance." />
        ) : (
          <div className="border border-gray-100 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  {['Patient', 'Ward / bed', 'Admitted', 'Deposit held', 'Balance', ''].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.data.map((a) => (
                  <tr key={a.id} className="border-t border-gray-100">
                    <td className="px-3 py-2.5">
                      {a.patient.firstName} {a.patient.lastName} <span className="text-gray-400">({a.patient.patientNumber})</span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-500">{a.ward?.name ?? '-'} / {a.bed?.label ?? '-'}</td>
                    <td className="px-3 py-2.5 text-gray-500">{d(a.admittedAt)}</td>
                    <td className="px-3 py-2.5 font-medium">{naira(a.totalDeposited)}</td>
                    <td className="px-3 py-2.5 font-medium" style={{ color: Number(a.balance) > 0 ? '#DC2626' : '#047857' }}>{naira(a.balance)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <div className="flex gap-2 justify-end">
                        <Button variant="secondary" onClick={() => setPrintingFor(a)}>Print bill</Button>
                        {Number(a.totalDeposited) > 0 && Number(a.balance) > 0 && (
                          <Button variant="secondary" onClick={() => setApplyFor({ admissionId: a.id, max: Math.min(Number(a.totalDeposited), Number(a.balance)) })}>
                            Apply deposit
                          </Button>
                        )}
                        {canRefund && a.deposits.map((dep) => (
                          <Button
                            key={dep.id}
                            variant="secondary"
                            onClick={() => setRefundingFor({ admissionId: a.id, id: dep.id, max: Number(dep.remaining) })}
                          >
                            Refund
                          </Button>
                        ))}
                        <Button onClick={() => setDepositFor(a.id)}>+ Deposit</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {depositFor && (
        <AddDepositModal admissionId={depositFor} open onClose={() => setDepositFor(null)} onDone={refresh} />
      )}
      {applyFor && (
        <ApplyDepositModal admissionId={applyFor.admissionId} max={applyFor.max} open onClose={() => setApplyFor(null)} onDone={refresh} />
      )}
      <RefundDepositModal
        admissionId={refundingFor?.admissionId ?? ''}
        deposit={refundingFor ? { id: refundingFor.id, max: refundingFor.max } : null}
        onClose={() => setRefundingFor(null)}
        onDone={refresh}
      />
      <PrintBillModal admission={printingFor} onClose={() => setPrintingFor(null)} />
    </div>
  )
}

/** The full bill (invoices + lines) is only fetched once a specific
 * admission's "Print bill" is clicked - the overview list only carries
 * totals, not line detail. */
function PrintBillModal({ admission, onClose }: { admission: AdmissionBillingOverviewDTO | null; onClose: () => void }) {
  const bill = useQuery({
    queryKey: ['admission-bill', admission?.id],
    queryFn: () => getAdmissionBill(admission!.id),
    enabled: !!admission,
  })

  return (
    <AdmissionBillPrintModal
      bill={bill.data ?? null}
      patient={{ name: admission ? `${admission.patient.firstName} ${admission.patient.lastName}` : '', patientNumber: admission?.patient.patientNumber ?? '' }}
      open={!!admission}
      onClose={onClose}
    />
  )
}
