'use client'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { can } from '@/lib/permissions'
import { ClaimsTab } from '@/components/claims/ClaimsTab'
import { BatchesTab } from '@/components/claims/BatchesTab'
import { RemittancesTab } from '@/components/claims/RemittancesTab'
import { ReceivablesTab } from '@/components/claims/ReceivablesTab'

const TABS = ['Claims', 'Batches', 'Remittances', 'Receivables'] as const
type Tab = (typeof TABS)[number]

export default function ClaimsPage() {
  const { data: session } = useSession()
  const allowed = can(session?.role, 'claims:manage')
  const [tab, setTab] = useState<Tab>('Claims')
  const [providerFilter, setProviderFilter] = useState('')

  if (!allowed) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Claims</h1>
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6">
          HMO claims are available to hospital admins and accountants.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-[#F7F9FC] overflow-hidden">
      <div className="px-8 pt-7 pb-4 flex-shrink-0 bg-white">
        <h1 className="text-2xl font-bold text-gray-900">Claims</h1>
        <p className="text-sm text-gray-500 mt-0.5">Turn HMO care into tracked demands and reconcile the money back.</p>
      </div>

      <div data-tour="claims-main" className="px-8 flex gap-6 flex-shrink-0 border-b border-[#D6DEE8] bg-white">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`py-3 text-sm font-medium transition-colors ${
              tab === t ? 'border-b-2 border-primary text-primary' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {tab === 'Claims' && (
          <ClaimsTab providerFilter={providerFilter} onProviderFilter={setProviderFilter} />
        )}
        {tab === 'Batches' && <BatchesTab />}
        {tab === 'Remittances' && <RemittancesTab />}
        {tab === 'Receivables' && (
          <ReceivablesTab onProvider={(id) => { setProviderFilter(id); setTab('Claims') }} />
        )}
      </div>
    </div>
  )
}
