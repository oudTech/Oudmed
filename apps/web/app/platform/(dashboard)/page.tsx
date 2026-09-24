'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { platformApiClient, naira } from '@/lib/platform'
import { StatCard } from '@/components/platform/StatCard'
import { RevenueChart } from '@/components/platform/RevenueChart'
import { StatusDonut } from '@/components/platform/StatusDonut'
import { ActivityFeed } from '@/components/platform/ActivityFeed'

export default function PlatformOverviewPage() {
  const overview = useQuery({ queryKey: ['platform-overview'], queryFn: platformApiClient.overview })
  const activity = useQuery({ queryKey: ['platform-activity', 1], queryFn: () => platformApiClient.activity(1) })

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Overview</h1>
        <p className="text-sm text-gray-500 mt-1">Platform-wide performance across every hospital.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total hospitals" value={overview.data?.totalHospitals ?? '-'} />
        <StatCard label="New this month" value={overview.data?.newThisMonth ?? '-'} />
        <StatCard label="Trialing" value={overview.data?.statusCounts.TRIALING ?? '-'} />
        <StatCard
          label="Estimated MRR"
          value={overview.data ? naira(overview.data.estimatedMonthlyRevenue) : '-'}
          hint="Sum of active + trialing seat pricing"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-gray-100 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Revenue overview</h2>
          {overview.data ? <RevenueChart data={overview.data.revenueTrend} /> : <p className="text-sm text-gray-400">Loading…</p>}
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Subscription overview</h2>
          {overview.data ? <StatusDonut counts={overview.data.statusCounts} /> : <p className="text-sm text-gray-400">Loading…</p>}
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">Platform activity</h2>
          <Link href="/platform/hospitals" className="text-sm text-primary font-medium hover:underline">
            View all hospitals
          </Link>
        </div>
        <ActivityFeed items={activity.data?.rows ?? []} loading={!activity.data} />
      </div>
    </div>
  )
}
