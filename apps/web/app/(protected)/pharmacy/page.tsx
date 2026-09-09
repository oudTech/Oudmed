'use client'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { can } from '@/lib/permissions'
import { InventoryList } from '@/components/pharmacy/InventoryList'
import { DispensingQueue } from '@/components/pharmacy/DispensingQueue'

const TABS = ['Inventory', 'Dispensing'] as const
type Tab = (typeof TABS)[number]

export default function PharmacyPage() {
  const { data: session } = useSession()
  const [tab, setTab] = useState<Tab>('Inventory')

  if (!can(session?.role, 'pharmacy:manage')) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Pharmacy</h1>
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6">
          The pharmacy workspace is available to pharmacists and hospital admins.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="px-8 pt-7 pb-4 flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-900">Pharmacy</h1>
      </div>

      <div data-tour="pharmacy-tabs" className="px-8 flex gap-6 flex-shrink-0 border-b border-[#D6DEE8]">
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

      <div className="flex-1 overflow-y-auto">
        {tab === 'Inventory' ? <InventoryList /> : <DispensingQueue />}
      </div>
    </div>
  )
}
