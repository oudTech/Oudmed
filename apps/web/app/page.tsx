'use client'
import { useState } from 'react'
import Link from 'next/link'
import AuthShell from '@/components/auth/AuthShell'
import { SubmitButton } from '@/components/auth/fields'
import { ROOT_DOMAIN, tenantUrl } from '@/lib/tenant'

export default function ApexLanding() {
  const [slug, setSlug] = useState('')

  const go = (e: React.FormEvent) => {
    e.preventDefault()
    const s = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (s) window.location.href = tenantUrl(s, '/login')
  }

  return (
    <AuthShell>
      <h1 className="text-2xl font-bold text-gray-900 text-center">Go to your hospital</h1>
      <p className="text-sm text-gray-500 text-center mt-1.5">
        Sign in at your hospital&apos;s own address.
      </p>

      <form onSubmit={go} className="mt-8">
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Hospital address</label>
        <div className="flex items-stretch border border-gray-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-primary focus-within:border-transparent">
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="your-hospital"
            className="flex-1 px-4 py-2.5 text-sm focus:outline-none"
            autoFocus
          />
          <span className="px-3 flex items-center text-sm text-gray-400 bg-gray-50 border-l border-gray-200 whitespace-nowrap">
            .{ROOT_DOMAIN.replace(/:\d+$/, '')}
          </span>
        </div>
        <div className="mt-4">
          <SubmitButton>Continue</SubmitButton>
        </div>
      </form>

      <div className="relative my-5">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-white px-3 text-gray-400">New to Oudmed?</span>
        </div>
      </div>

      <Link
        href="/signup"
        className="block text-center border border-gray-200 rounded-lg py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
      >
        Create a hospital
      </Link>
    </AuthShell>
  )
}
