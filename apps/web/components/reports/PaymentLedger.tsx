'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/kit'
import { reportsApi, formatNaira } from '@/lib/reports'
import { Pagination } from '@/components/admin/AdminRowActions'

export function PaymentLedger({
  range,
  filter,
  onClearFilter,
}: {
  range: { preset?: string; from?: string; to?: string }
  filter: { kind: 'department' | 'doctor'; id: string; label: string } | null
  onClearFilter: () => void
}) {
  const [page, setPage] = useState(1)
  const [downloading, setDownloading] = useState(false)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const hasCustomRange = !!customFrom && !!customTo
  // String compare is safe here: both inputs are HTML date values, always yyyy-mm-dd.
  const rangeError = hasCustomRange && customFrom > customTo
    ? '"From" date must be on or before "to" date.'
    : null
  const effectiveRange = hasCustomRange ? { from: customFrom, to: customTo } : range

  const params = {
    ...effectiveRange,
    departmentId: filter?.kind === 'department' ? filter.id : undefined,
    doctorId: filter?.kind === 'doctor' ? filter.id : undefined,
    page,
  }

  const list = useQuery({
    queryKey: ['report-payments', params],
    queryFn: () => reportsApi.payments(params),
    enabled: !rangeError,
  })

  const download = async () => {
    if (rangeError) return
    setDownloading(true)
    try {
      await reportsApi.downloadPaymentsCsv({
        ...effectiveRange,
        departmentId: params.departmentId,
        doctorId: params.doctorId,
      })
    } finally {
      setDownloading(false)
    }
  }

  const clearCustomRange = () => {
    setCustomFrom('')
    setCustomTo('')
    setPage(1)
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Payment ledger</h2>
          <p className="text-sm text-gray-500">
            {list.data ? `${list.data.total} transaction${list.data.total === 1 ? '' : 's'}` : 'Loading…'}
            {list.data && ` · ${formatNaira(list.data.totalAmount)} net cash collected`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {filter && (
            <button
              onClick={() => { onClearFilter(); setPage(1) }}
              className="rounded-lg bg-blue-50 px-3 py-1.5 text-sm font-medium text-primary"
            >
              {filter.label} &times;
            </button>
          )}
          <div className="flex items-center gap-1.5 text-sm">
            <label className="text-gray-500">From</label>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => { setCustomFrom(e.target.value); setPage(1) }}
              className="rounded-lg border border-gray-200 px-2 py-1.5"
            />
            <label className="text-gray-500">to</label>
            <input
              type="date"
              value={customTo}
              onChange={(e) => { setCustomTo(e.target.value); setPage(1) }}
              className="rounded-lg border border-gray-200 px-2 py-1.5"
            />
            {hasCustomRange && (
              <button onClick={clearCustomRange} className="text-gray-400 hover:text-gray-600" aria-label="Clear custom date range">
                &times;
              </button>
            )}
          </div>
          <Button variant="secondary" onClick={download} loading={downloading} disabled={!!rangeError}>
            Export CSV
          </Button>
        </div>
      </div>
      {rangeError && (
        <p className="px-6 pb-3 text-sm text-red-600">{rangeError}</p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              {['Date', 'Type', 'Invoice', 'Patient', 'Amount', 'Paid by', 'Cashier', 'Comment', 'Status', 'Reversed'].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!list.data ? (
              <tr><td colSpan={10} className="px-4 py-6 text-gray-400">Loading…</td></tr>
            ) : list.data.rows.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-6 text-center text-gray-400">No payments in this period.</td></tr>
            ) : (
              list.data.rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-4 py-2.5 text-gray-600">{new Date(r.paidAt).toLocaleDateString('en-GB')}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium"
                      style={r.entryType === 'DEPOSIT_REFUND'
                        ? { color: '#B45309', backgroundColor: '#FFF6E5' }
                        : r.entryType === 'DEPOSIT'
                          ? { color: '#1E40AF', backgroundColor: '#E4EFFF' }
                          : { color: '#374151', backgroundColor: '#F3F4F6' }}
                    >
                      {r.entryType === 'DEPOSIT' ? 'Deposit' : r.entryType === 'DEPOSIT_REFUND' ? 'Deposit refund' : 'Payment'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {r.invoiceId ? (
                      <Link href={`/billing?open=${r.invoiceId}`} className="text-primary hover:underline">{r.invoiceNumber}</Link>
                    ) : r.admissionId ? (
                      <Link href={`/admissions/${r.admissionId}`} className="text-primary hover:underline">{r.invoiceNumber}</Link>
                    ) : (
                      <span className="text-gray-400">{r.invoiceNumber}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-800">{r.patientName}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-900">{formatNaira(r.amount)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{r.paidBy}</td>
                  <td className="px-4 py-2.5 text-gray-600">{r.cashier ?? '-'}</td>
                  <td className="px-4 py-2.5 max-w-[16rem] truncate text-gray-500">{r.comment ?? '-'}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium"
                      style={r.status === 'Reversed'
                        ? { color: '#B42318', backgroundColor: '#FEECEB' }
                        : { color: '#047857', backgroundColor: '#EAF7F0' }}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">
                    {r.reversedAt ? new Date(r.reversedAt).toLocaleDateString('en-GB') : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="px-6 pb-4">
        {list.data && (
          <Pagination
            page={page}
            total={list.data.total}
            pageSize={list.data.pageSize}
            noun="transactions"
            onPage={setPage}
          />
        )}
      </div>
    </div>
  )
}
