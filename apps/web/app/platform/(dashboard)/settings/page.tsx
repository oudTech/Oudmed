'use client'
import { useState } from 'react'
import { GeneralSettingsTab } from '@/components/platform/settings/GeneralSettingsTab'
import { AdminAccountTab } from '@/components/platform/settings/AdminAccountTab'
import { PricingSettingsTab } from '@/components/platform/settings/PricingSettingsTab'
import { PlatformUsersTab } from '@/components/platform/settings/PlatformUsersTab'
import { MaintenanceModeTab } from '@/components/platform/settings/MaintenanceModeTab'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'account', label: 'Admin account' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'users', label: 'Platform users' },
  { id: 'maintenance', label: 'Maintenance mode' },
] as const

export default function PlatformSettingsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('general')

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-7 pb-4 flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Platform-wide configuration.</p>
      </div>
      <div className="px-8 flex gap-6 flex-shrink-0 border-b border-[#D6DEE8]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`py-3 text-sm font-medium transition-colors ${
              tab === t.id ? 'border-b-2 border-primary text-primary' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-8">
        {tab === 'general' && <GeneralSettingsTab />}
        {tab === 'account' && <AdminAccountTab />}
        {tab === 'pricing' && <PricingSettingsTab />}
        {tab === 'users' && <PlatformUsersTab />}
        {tab === 'maintenance' && <MaintenanceModeTab />}
      </div>
    </div>
  )
}
