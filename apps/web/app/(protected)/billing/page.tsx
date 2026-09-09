'use client'
import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { InvoiceListItemDTO } from '@oudhealth/contracts'
import { Button } from '@/components/ui/kit'
import { can } from '@/lib/permissions'
import { billingApi, naira, INVOICE_STATUS_META, STATUS_CHIPS, CATEGORY_CHIPS } from '@/lib/billing'
import { InvoiceDetailDrawer } from '@/components/billing/InvoiceDetailDrawer'
import { RecordPaymentModal } from '@/components/billing/RecordPaymentModal'
import { EmptyState } from '@/components/onboarding'

const d = (iso: string) => new Date(iso).toLocaleDateString('en-GB')
const todayISO = () => new Date().toISOString().slice(0, 10)

export default function BillingPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading…</div>}>
      <BillingInner />
    </Suspense>
  )
}

function BillingInner() {
  const { data: session } = useSession()
  const router = useRouter()
  const params = useSearchParams()
  const allowed = can(session?.role, 'billing:manage') || can(session?.role, 'invoice:pay')

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [from, setFrom] = useState(todayISO())
  const [to, setTo] = useState(todayISO())
  const [allDates, setAllDates] = useState(false)
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(params.get('open'))
  const [payRow, setPayRow] = useState<InvoiceListItemDTO | null>(null)

  const list = useQuery({
    queryKey: ['billing-invoices', search, status, category, allDates ? 'all' : from, allDates ? 'all' : to, page],
    queryFn: () =>
      billingApi.listInvoices({
        search: search || undefined,
        status: status || undefined,
        category: category || undefined,
        from: allDates ? undefined : from,
        to: allDates ? undefined : `${to}T23:59:59`,
        page,
      }),
    enabled: allowed,
  })

  if (!allowed) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Invoices</h1>
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6">
          You do not have access to billing.
        </p>
      </div>
    )
  }

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="px-8 pt-7 pb-4 flex items-center justify-between flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
        {can(session?.role, 'billing:manage') && (
          <Link href="/billing/new" className="bg-primary text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#2b58c9]">
            + New invoice
          </Link>
        )}
      </div>
      <div className="border-b border-[#D6DEE8] flex-shrink-0" />

      <div className="flex-1 overflow-y-auto p-8">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search invoice # or patient"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-64"
          />
          {STATUS_CHIPS.map((s) => (
            <button
              key={s.value}
              onClick={() => { setStatus(s.value); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${status === s.value ? 'bg-blue-50 text-primary' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-gray-400 mr-1">Category:</span>
          <button
            onClick={() => { setCategory(''); setPage(1) }}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium ${category === '' ? 'bg-blue-50 text-primary' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            All
          </button>
          {CATEGORY_CHIPS.map((c) => (
            <button
              key={c}
              onClick={() => { setCategory(c); setPage(1) }}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium ${category === c ? 'bg-blue-50 text-primary' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              {c}
            </button>
          ))}
          <div className="flex-1" />
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" checked={allDates} onChange={(e) => { setAllDates(e.target.checked); setPage(1) }} />
            All dates
          </label>
          {!allDates && (
            <>
              <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className="border border-gray-200 rounded-lg px-2 py-1 text-xs" />
              <span className="text-gray-400 text-xs">to</span>
              <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} className="border border-gray-200 rounded-lg px-2 py-1 text-xs" />
            </>
          )}
        </div>

        <div data-tour="billing-list" className="border border-gray-100 rounded-xl overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                {['#', 'Creation Date', 'Patient', 'Category', 'Amount', 'Paid', 'Balance due', 'Status', ''].map((h) => (
                  <th key={h} className="text-left font-medium px-3 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!list.data ? (
                <tr><td colSpan={9} className="px-3 py-6 text-gray-400">Loading…</td></tr>
              ) : list.data.invoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3">
                    <EmptyState
                      compact
                      title="No invoices in this view"
                      description={
                        search || status || category
                          ? 'Nothing matches these filters. Widen the date range or clear the filters.'
                          : 'Completed visits raise their own invoice. Ad-hoc bills you create also land here.'
                      }
                    />
                  </td>
                </tr>
              ) : (
                list.data.invoices.map((inv) => {
                  const m = INVOICE_STATUS_META[inv.status]
                  return (
                    <tr key={inv.id} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setOpenId(inv.id)}>
                      <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{inv.invoiceNumber}</td>
                      <td className="px-3 py-2.5 text-gray-500">{d(inv.createdAt)}</td>
                      <td className="px-3 py-2.5">{inv.patient?.name ?? '-'}</td>
                      <td className="px-3 py-2.5 text-gray-500">{inv.category ?? '-'}</td>
                      <td className="px-3 py-2.5">{naira(inv.totalAmount)}</td>
                      <td className="px-3 py-2.5 text-gray-500">{naira(inv.paidAmount)}</td>
                      <td className="px-3 py-2.5 font-medium">{naira(inv.balanceDue)}</td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-medium rounded-full px-2 py-0.5" style={{ color: m.color, backgroundColor: m.bg }}>{m.label}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        {inv.status !== 'PAID' && inv.status !== 'CANCELLED' && can(session?.role, 'invoice:pay') && (
                          <button className="bg-primary text-white text-xs font-semibold px-3 py-1.5 rounded-md hover:bg-[#2b58c9]" onClick={() => setPayRow(inv)}>
                            Pay
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
              {list.data && list.data.invoices.length > 0 && (
                <tr className="border-t-2 border-gray-200 bg-blue-50/40 font-bold">
                  <td className="px-3 py-3" colSpan={4}>{allDates ? 'All' : from === to ? d(from + 'T00:00') : `${d(from + 'T00:00')} to ${d(to + 'T00:00')}`} · {list.data.summary.count} invoice(s)</td>
                  <td className="px-3 py-3">{naira(list.data.summary.amount)}</td>
                  <td className="px-3 py-3">{naira(list.data.summary.paid)}</td>
                  <td className="px-3 py-3">{naira(list.data.summary.balance)}</td>
                  <td colSpan={2} />
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {list.data && list.data.total > list.data.pageSize && (
          <div className="flex items-center justify-between mt-4 text-sm">
            <span className="text-gray-400">
              Showing {(page - 1) * list.data.pageSize + 1} to {Math.min(page * list.data.pageSize, list.data.total)} of {list.data.total} invoices
            </span>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="w-7 h-7 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50">‹</button>
              <span className="px-2 text-gray-600">{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="w-7 h-7 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50">›</button>
            </div>
          </div>
        )}
      </div>

      <InvoiceDetailDrawer
        invoiceId={openId}
        open={!!openId}
        onClose={() => { setOpenId(null); router.replace('/billing') }}
      />
      <RecordPaymentModal
        open={!!payRow}
        onClose={() => setPayRow(null)}
        invoice={payRow ? { id: payRow.id, invoiceNumber: payRow.invoiceNumber, patientName: payRow.patient?.name ?? '', balanceDue: payRow.balanceDue } : null}
      />
    </div>
  )
}
