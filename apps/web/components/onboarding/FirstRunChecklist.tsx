'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import type { OnboardingAnalyticsEvent } from '@/lib/onboarding/types'
import { milestoneReached } from '@/lib/onboarding/analytics'
import { useOnboarding } from './OnboardingProvider'

const DISMISS_ID = 'first-run-checklist'

type Task = { label: string; hint: string; event: OnboardingAnalyticsEvent; href: string; cta: string }

/**
 * Role-specific "do this once" list for a new user's first session. Each item
 * ticks itself when the matching milestone fires (see `trackFirst`). The card
 * disappears once every item is done or the user dismisses it - the dismiss is
 * stored server-side so it stays gone on every device.
 */
const BY_ROLE: Record<string, Task[]> = {
  RECEPTIONIST: [
    {
      label: 'Register your first patient',
      hint: 'Name and contact is enough to create the record.',
      event: 'first_patient_created',
      href: '/patients/new',
      cta: 'Register',
    },
    {
      label: 'Book your first appointment',
      hint: 'Put a patient on a doctor\'s calendar.',
      event: 'first_appointment_created',
      href: '/schedule',
      cta: 'Schedule',
    },
  ],
  DOCTOR: [
    {
      label: 'Complete your first consultation',
      hint: 'Open a checked-in patient, record the visit, then mark it complete.',
      event: 'first_consultation_completed',
      href: '/schedule',
      cta: 'Today',
    },
  ],
}

export function FirstRunChecklist() {
  const { data: session } = useSession()
  const { seenFeatures, markFeatureSeen } = useOnboarding()
  const tasks = BY_ROLE[session?.role ?? '']

  // milestone flags live in localStorage; re-read when the tab regains focus
  const [, force] = useState(0)
  useEffect(() => {
    const on = () => force((n) => n + 1)
    window.addEventListener('focus', on)
    return () => window.removeEventListener('focus', on)
  }, [])

  if (!tasks || seenFeatures.includes(DISMISS_ID)) return null

  const done = tasks.map((t) => milestoneReached(t.event))
  const doneCount = done.filter(Boolean).length
  if (doneCount === tasks.length) return null

  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">Your first steps</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {doneCount} of {tasks.length} done. Learn the flow by doing it once.
          </p>
        </div>
        <button
          onClick={() => markFeatureSeen(DISMISS_ID)}
          className="text-xs font-medium text-gray-400 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          Dismiss
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {tasks.map((t, i) => (
          <li key={t.event} className="flex items-center gap-3">
            <span
              className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${
                done[i] ? 'border-[#0DA76C] bg-[#0DA76C] text-white' : 'border-gray-300 bg-white text-transparent'
              }`}
              aria-hidden
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 12 5 5L20 7" />
              </svg>
            </span>
            <span className="flex-1">
              <span className={`text-sm ${done[i] ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                {t.label}
              </span>
              {!done[i] && <span className="block text-xs text-gray-500">{t.hint}</span>}
            </span>
            {!done[i] && (
              <Link
                href={t.href}
                className="flex-shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                {t.cta}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
