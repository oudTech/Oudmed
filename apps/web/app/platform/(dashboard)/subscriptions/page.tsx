'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Select } from '@/components/ui/kit'
import { Pagination } from '@/components/admin/AdminRowActions'
import { useToast } from '@/components/ui/feedback'
import { platformApiClient, naira, STATUS_BADGE, STATUS_LABEL } from '@/lib/platform'
import { StatCard } from '@/components/platform/StatCard'
import { HospitalDetailDrawer } from '@/components/platform/HospitalDetailDrawer'

export default function SubscriptionsPage() {
  const toast = useToast()
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const stats = useQuery({ queryKey: ['platform-subscription-stats'], queryFn: platformApiClient.subscriptions.stats })
  const list = useQuery({
    queryKey: ['platform-subscriptions', status, page],
    queryFn: () => platformApiClient.subscriptions.list({ status, page }),
  })

  async function handleExport() {
    setExporting(true)
    try {
      await platformApiClient.subscriptions.exportCsv({ status })
    } catch {
      toast('Could not export subscriptions.', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Subscriptions</h1>
          <p className="text-sm text-gray-500 mt-1">Billing status across every hospital.</p>
        </div>
        <Button variant="secondary" loading={exporting} onClick={handleExport}>Export</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Successful invoices" value={stats.data?.successful ?? '-'} />
        <StatCard label="Failed invoices" value={stats.data?.failed ?? '-'} />
        <StatCard label="Pending invoices" value={stats.data?.pending ?? '-'} />
        <StatCard label="Refunded" value={stats.data?.refunded ?? 0} hint="No refund flow yet" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="w-40">
          <option value="all">All status</option>
          <option value="trialing">Trialing</option>
          <option value="active">Active</option>
          <option value="past_due">Past due</option>
          <option value="suspended">Suspended</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </div>

      <div className="border border-gray-100 rounded-xl overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              {['Hospital', 'Status', 'Billing', 'Price', 'Renews / Trial ends', ''].map((h) => (
                <th key={h} className="text-left font-medium px-3 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!list.data ? (
              <tr><td colSpan={6} className="px-3 py-6 text-gray-400">Loading…</td></tr>
            ) : list.data.rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-6 text-gray-400 text-center">No subscriptions match this view.</td></tr>
            ) : (
              list.data.rows.map((row) => (
                <tr
                  key={row.tenantId}
                  className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setSelected(row.tenantId)}
                >
                  <td className="px-3 py-2.5 font-medium text-gray-900">{row.hospitalName}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className="text-xs font-medium rounded-full px-2 py-0.5"
                      style={{ color: STATUS_BADGE[row.status]?.color, backgroundColor: STATUS_BADGE[row.status]?.bg }}
                    >
                      {STATUS_LABEL[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-500">{row.billingCycle === 'ANNUAL' ? 'Annually' : 'Monthly'}</td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {naira(row.billingCycle === 'ANNUAL' ? row.annualGross : row.monthlyGross)}
                  </td>
                  <td className="px-3 py-2.5 text-gray-500">
                    {row.currentPeriodEnd
                      ? new Date(row.currentPeriodEnd).toLocaleDateString()
                      : row.trialEndsAt
                        ? new Date(row.trialEndsAt).toLocaleDateString()
                        : '-'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-primary font-medium">View</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {list.data && (
        <Pagination page={page} total={list.data.total} pageSize={list.data.pageSize} noun="subscriptions" onPage={setPage} />
      )}

      {selected && (
        <HospitalDetailDrawer
          tenantId={selected}
          onClose={() => setSelected(null)}
          onChanged={() => { list.refetch(); stats.refetch() }}
        />
      )}
    </div>
  )
}
