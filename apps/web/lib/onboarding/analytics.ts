import type { OnboardingAnalyticsEvent } from './types'

/**
 * Onboarding analytics sink. The HMS has no analytics backend yet, so this is a
 * dev-console logger + a no-op in production. To wire a real destination, add
 * ONE line inside `track()` - e.g. `posthog.capture(event, props)` or
 * `api.post('/analytics/events', { event, props })`. Nothing else changes.
 */
export function track(
  event: OnboardingAnalyticsEvent,
  props: Record<string, unknown> = {},
): void {
  const payload = { event, ...props, at: new Date().toISOString() }
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.debug('[onboarding]', payload)
  }
  // <-- add your analytics destination here -->
}

/**
 * Fire a milestone event only the first time it happens for this browser
 * (e.g. `first_patient_created`). Guarded by localStorage so a real backend
 * still gets a clean once-per-user signal without a schema change.
 */
export function trackFirst(
  event: OnboardingAnalyticsEvent,
  props: Record<string, unknown> = {},
): void {
  const key = `oud.milestone.${event}`
  try {
    if (typeof window !== 'undefined') {
      if (window.localStorage.getItem(key)) return
      window.localStorage.setItem(key, '1')
    }
  } catch {
    /* private mode - fall through and just track it */
  }
  track(event, props)
}

/** Whether a `trackFirst` milestone has fired on this browser. */
export function milestoneReached(event: OnboardingAnalyticsEvent): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage.getItem(`oud.milestone.${event}`)
  } catch {
    return false
  }
}
