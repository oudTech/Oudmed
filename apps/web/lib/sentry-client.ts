import * as Sentry from '@sentry/nextjs'

/**
 * Error tracking, off by default. Set NEXT_PUBLIC_SENTRY_DSN (build-time, like
 * the other NEXT_PUBLIC_* config in this app) to turn it on. Deliberately not
 * using @sentry/nextjs's next.config.js wrapper (source-map upload, extra
 * webpack instrumentation) to keep this a small, low-risk addition - just
 * capturing exceptions, not full tracing/replay.
 */
let initialized = false

export function initSentryClient(): void {
  if (initialized) return
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()
  if (!dsn) return
  initialized = true
  Sentry.init({ dsn, environment: process.env.NODE_ENV ?? 'development', tracesSampleRate: 0 })
}

export { Sentry }
