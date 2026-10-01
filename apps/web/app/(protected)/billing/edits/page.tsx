'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { can } from '@/lib/permissions'
import { billingApi, naira } from '@/lib/billing'
import { EmptyState } from '@/components/onboarding'

const dt = (iso: string) => new Date(iso).toLocaleString('en-GB')
const ACTION_LABEL: Record<string, string> = { ADD_LINE: 'Added', UPDATE_LINE: 'Edited', VOID_LINE: 'Removed' }

const num = (v: unknown) => (v == null ? null : Number(v))

export default function BillingEditsReportPage() {
  const { data: session } = useSession()
  const allowed = can(session?.role, 'billing:manage')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const rangeError = from && to && from > to ? '"From" date must be on or before "to" date.' : null

  const q = useQuery({
    queryKey: ['billing-line-edits', from, to],
    queryFn: () => billingApi.lineEditsReport({ from: from || undefined, to: to || undefined }),
    enabled: allowed && !rangeError,
  })

  if (!allowed) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Invoice edit history</h1>
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6">
          You do not have access to billing.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="px-8 pt-7 pb-4 flex-shrink-0">
        <Link href="/billing" className="text-sm text-gray-400 hover:text-gray-700">&larr; Invoices</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Invoice edit history</h1>
        <p className="text-sm text-gray-400 mt-1">
          Every manual price change, discount and line removal made from the billing screen, for review.
        </p>
      </div>

      <div className="px-8 flex items-center gap-2 flex-shrink-0 pb-4">
        <label className="text-sm text-gray-500">From</label>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
        <label className="text-sm text-gray-500">to</label>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
        {rangeError && <span className="text-sm text-red-600 ml-2">{rangeError}</span>}
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {!q.data ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : q.data.length === 0 ? (
          <EmptyState compact title="No manual edits in this range" description="Nothing to review - billing-desk line edits will show up here." />
        ) : (
          <div className="border border-gray-100 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  {['Date', 'Invoice', 'Action', 'By', 'Before', 'After', 'Reason'].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.data.map((r) => {
                  const before = r.before as Record<string, unknown> | null
                  const after = r.after as Record<string, unknown> | null
                  return (
                    <tr key={r.id} className="border-t border-gray-100">
                      <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{dt(r.createdAt)}</td>
                      <td className="px-3 py-2.5">
                        {r.invoiceNumber ? (
                          <Link href={`/billing?open=${r.invoiceId}`} className="text-primary hover:underline">{r.invoiceNumber}</Link>
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2.5">{ACTION_LABEL[r.action] ?? r.action}</td>
                      <td className="px-3 py-2.5 text-gray-600">{r.userName ?? '-'}</td>
                      <td className="px-3 py-2.5 text-gray-500">
                        {before ? `${before.description ?? ''} · ${naira(num(before.unitPrice) ?? 0)} x${before.quantity ?? ''}` : '-'}
                      </td>
                      <td className="px-3 py-2.5 text-gray-500">
                        {after ? `${after.description ?? ''} · ${naira(num(after.unitPrice) ?? 0)} x${after.quantity ?? ''}` : '-'}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 max-w-[16rem] truncate">{r.reason ?? '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
