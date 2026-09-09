'use client'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { can } from '@/lib/permissions'
import { ServicesTab } from '@/components/admin/ServicesTab'
import { DepartmentsTab } from '@/components/admin/DepartmentsTab'
import { ProvidersTab } from '@/components/admin/ProvidersTab'

const TABS = ['Services', 'Departments', 'Insurance & companies'] as const
type Tab = (typeof TABS)[number]

export default function AdminPage() {
  const { data: session } = useSession()
  const allowed = can(session?.role, 'admin:settings')
  const [tab, setTab] = useState<Tab>('Services')

  if (!allowed) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Administration</h1>
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6">
          Only a hospital admin can manage services, departments and insurance providers.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="px-8 pt-7 pb-4 flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-900">Administration</h1>
        <p className="text-sm text-gray-500 mt-1">Master data for billing, scheduling and payers.</p>
      </div>

      <div data-tour="admin-tabs" className="px-8 flex gap-6 flex-shrink-0 border-b border-[#D6DEE8]">
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

      <div className="flex-1 overflow-y-auto p-8">
        {tab === 'Services' && <ServicesTab />}
        {tab === 'Departments' && <DepartmentsTab />}
        {tab === 'Insurance & companies' && <ProvidersTab />}
      </div>
    </div>
  )
}
