'use client'
import { useOnboarding } from './OnboardingProvider'

/**
 * A one-time "✨ New" note next to a feature the user has not seen yet.
 * Dismissing it (or the `onSeen` side effect) records the flag server-side so it
 * never shows again, on any device.
 *
 *   <FeatureCallout id="reports-csv-export" title="Export to CSV"
 *     body="Download any report as a spreadsheet for your own analysis." />
 */
export function FeatureCallout({
  id,
  title,
  body,
  className = '',
}: {
  id: string
  title: string
  body: string
  className?: string
}) {
  const { seenFeatures, markFeatureSeen } = useOnboarding()
  if (seenFeatures.includes(id)) return null

  return (
    <div
      role="status"
      className={`relative rounded-xl border border-blue-100 bg-blue-50/60 p-3 pr-9 text-sm ${className}`}
    >
      <p className="font-semibold text-gray-900">
        <span aria-hidden>✨ </span>
        {title}
      </p>
      <p className="mt-0.5 text-gray-600">{body}</p>
      <button
        onClick={() => markFeatureSeen(id)}
        aria-label="Dismiss"
        className="absolute right-2 top-2 rounded p-1 text-gray-400 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

/** Imperative variant: returns whether to show + a dismiss fn. */
export function useFeatureDiscovery(id: string) {
  const { seenFeatures, markFeatureSeen } = useOnboarding()
  return { show: !seenFeatures.includes(id), dismiss: () => markFeatureSeen(id) }
}
