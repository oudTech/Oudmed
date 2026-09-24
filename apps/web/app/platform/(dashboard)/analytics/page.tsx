'use client'
import { useQuery } from '@tanstack/react-query'
import { platformApiClient, naira } from '@/lib/platform'
import { StatCard } from '@/components/platform/StatCard'
import { RevenueChart } from '@/components/platform/RevenueChart'
import { StatusDonut } from '@/components/platform/StatusDonut'

export default function AnalyticsPage() {
  // Same query key as the Overview page - Analytics is a deeper view of the
  // same platform aggregate, not a second, separately-sourced dataset.
  const overview = useQuery({ queryKey: ['platform-overview'], queryFn: platformApiClient.overview })
  const data = overview.data

  const trendTotal = data ? data.revenueTrend.reduce((sum, m) => sum + Number(m.total), 0) : 0

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">Revenue and subscription trends across the platform.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Estimated MRR" value={data ? naira(data.estimatedMonthlyRevenue) : '-'} />
        <StatCard
          label={`Collected, last ${data?.revenueTrend.length ?? 6} months`}
          value={data ? naira(trendTotal) : '-'}
        />
        <StatCard label="Total hospitals" value={data?.totalHospitals ?? '-'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-gray-100 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Revenue over time</h2>
          {data ? <RevenueChart data={data.revenueTrend} /> : <p className="text-sm text-gray-400">Loading…</p>}
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Hospitals by status</h2>
          {data ? <StatusDonut counts={data.statusCounts} /> : <p className="text-sm text-gray-400">Loading…</p>}
        </div>
      </div>
    </div>
  )
}
