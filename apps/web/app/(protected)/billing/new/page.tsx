'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { PatientListItemDTO } from '@oudhealth/contracts'
import { Button, Field, Input } from '@/components/ui/kit'
import { can } from '@/lib/permissions'
import { searchPatients } from '@/lib/hospital'
import { billingApi, naira } from '@/lib/billing'
import { AddItemModal, type BuilderLine } from '@/components/billing/AddItemModal'

export default function NewInvoicePage() {
  const { data: session } = useSession()
  const router = useRouter()
  const allowed = can(session?.role, 'billing:manage')

  const [q, setQ] = useState('')
  const [patient, setPatient] = useState<PatientListItemDTO | null>(null)
  const [lines, setLines] = useState<BuilderLine[]>([])
  const [invoiceDiscount, setInvoiceDiscount] = useState('0')
  const [discountReason, setDiscountReason] = useState('')
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')

  const results = useQuery({
    queryKey: ['billing-patient-search', q],
    queryFn: () => searchPatients(q),
    enabled: allowed && !patient && q.trim().length >= 2,
  })

  const openInvoices = useQuery({
    queryKey: ['billing-open-for', patient?.id],
    queryFn: () => billingApi.listInvoices({ search: patient!.patientNumber, status: undefined, page: 1 }),
    enabled: !!patient,
  })
  const outstanding = (openInvoices.data?.invoices ?? []).filter((i) => i.status === 'UNPAID' || i.status === 'PARTIAL')

  const setLine = (key: string, patch: Partial<BuilderLine>) =>
    setLines((arr) => arr.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const lineNet = (l: BuilderLine) => l.unitPrice * l.quantity * (1 - (l.discountPct || 0) / 100)
  const subtotal = lines.reduce((s, l) => s + lineNet(l), 0)
  const invDisc = Number(invoiceDiscount) || 0
  const payable = subtotal * (1 - invDisc / 100)

  const m = useMutation({
    mutationFn: () =>
      billingApi.createInvoice({
        patientId: patient!.id,
        invoiceDiscountPct: invDisc || undefined,
        discountReason: invDisc ? discountReason.trim() || undefined : undefined,
        lines: lines.map((l) => ({
          category: l.category,
          serviceItemId: l.serviceItemId,
          drugId: l.drugId,
          description: l.description,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          discountPct: l.discountPct || undefined,
        })),
      }),
    onSuccess: (res) => router.push(`/billing?open=${res.id}`),
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not create the invoice.'),
  })

  if (!allowed) {
    return <div className="p-8 text-sm text-gray-500">You do not have access to create invoices.</div>
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="px-8 pt-7 pb-4 flex items-center gap-3 flex-shrink-0">
        <Link href="/billing" className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50">‹</Link>
        <h1 className="text-2xl font-bold text-gray-900">New invoice</h1>
      </div>
      <div className="border-b border-[#D6DEE8] flex-shrink-0" />

      <div className="flex-1 overflow-y-auto p-8 max-w-5xl">
        {!patient ? (
          <div className="relative max-w-lg">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patient name or phone number" />
            {q.trim().length >= 2 && (
              <div className="mt-1 border border-gray-100 rounded-xl divide-y max-h-72 overflow-y-auto">
                {(results.data ?? []).map((p) => (
                  <button
                    key={p.id}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50"
                    onClick={() => { setPatient(p); setQ('') }}
                  >
                    <span className="font-medium text-gray-900">{p.firstName} {p.lastName}</span>
                    <span className="text-gray-400 text-xs ml-2">{p.patientNumber} · {p.phone ?? 'no phone'}</span>
                  </button>
                ))}
                {results.data && results.data.length === 0 && (
                  <p className="px-4 py-3 text-sm text-gray-400">No patient found.</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="font-bold text-gray-900">{patient.firstName} {patient.lastName}</p>
                <p className="text-xs text-gray-400">{patient.patientNumber} · {patient.phone ?? 'no phone'}</p>
              </div>
              <button className="text-sm text-primary hover:underline" onClick={() => { setPatient(null); setLines([]) }}>Change</button>
            </div>

            {outstanding.length > 0 && (
              <div className="mb-4 rounded-xl bg-amber-50 border border-amber-100 px-4 py-2.5 text-sm text-amber-800 flex items-center justify-between">
                <span>
                  This patient has {outstanding.length} open invoice(s) · {naira(outstanding.reduce((s, i) => s + Number(i.balanceDue), 0))} outstanding.
                </span>
                <Link href={`/billing?open=${outstanding[0].id}`} className="font-semibold hover:underline">Review</Link>
              </div>
            )}

            <button
              onClick={() => setAdding(true)}
              className="w-full border-2 border-dashed border-[#3366E3]/40 text-primary rounded-xl py-3 text-sm font-medium hover:bg-blue-50/50 mb-4"
            >
              + Add item
            </button>

            {lines.length > 0 && (
              <div className="border border-gray-100 rounded-xl overflow-x-auto mb-4">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>{['Item', 'Type', 'Unit ₦', 'Qty', 'Stock', 'Discount %', 'Amount', ''].map((h) => (
                      <th key={h} className="text-left font-medium px-3 py-2">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.key} className="border-t border-gray-100">
                        <td className="px-3 py-2">{l.description}</td>
                        <td className="px-3 py-2 text-gray-500">{l.category}</td>
                        <td className="px-3 py-2 w-24">
                          <input type="number" className="border border-gray-200 rounded-md px-2 py-1 w-20 text-sm" value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: Number(e.target.value) })} />
                        </td>
                        <td className="px-3 py-2 w-16">
                          <input type="number" className="border border-gray-200 rounded-md px-2 py-1 w-14 text-sm" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: Number(e.target.value) })} />
                        </td>
                        <td className="px-3 py-2 text-gray-400 text-xs">{l.stock ?? '-'}</td>
                        <td className="px-3 py-2 w-20">
                          <input type="number" className="border border-gray-200 rounded-md px-2 py-1 w-16 text-sm" value={l.discountPct} onChange={(e) => setLine(l.key, { discountPct: Number(e.target.value) })} />
                        </td>
                        <td className="px-3 py-2">{naira(lineNet(l))}</td>
                        <td className="px-3 py-2 text-right">
                          <button className="text-gray-300 hover:text-red-500" onClick={() => setLines((arr) => arr.filter((x) => x.key !== l.key))}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {lines.length > 0 && (
              <div className="max-w-sm ml-auto space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{naira(subtotal)}</span></div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Discount on invoice, %</span>
                  <input type="number" className="border border-gray-200 rounded-md px-2 py-1 w-20 text-sm text-right" value={invoiceDiscount} onChange={(e) => setInvoiceDiscount(e.target.value)} />
                </div>
                {invDisc > 0 && (
                  <Field label="Discount reason">
                    <Input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="e.g. staff dependant" />
                  </Field>
                )}
                <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2">
                  <span>Total payable</span><span>{naira(payable)}</span>
                </div>
              </div>
            )}

            {err && <p className="text-sm text-red-600 mt-3">{err}</p>}
            <div className="flex justify-end mt-4">
              <Button
                loading={m.isPending}
                disabled={lines.length === 0 || (invDisc > 0 && discountReason.trim().length < 2)}
                onClick={() => { setErr(''); m.mutate() }}
              >
                Save &amp; Proceed
              </Button>
            </div>
          </>
        )}
      </div>

      <AddItemModal open={adding} onClose={() => setAdding(false)} onAdd={(l) => setLines((arr) => [...arr, l])} />
    </div>
  )
}
