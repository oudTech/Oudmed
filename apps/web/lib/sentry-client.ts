import * as Sentry from '@sentry/nextjs'

/**
 * Error tracking, off by default. Set NEXT_PUBLIC_SENTRY_DSN (build-time, like
 * the other NEXT_PUBLIC_* config in this app) to turn it on. Deliberately not
 * using @sentry/nextjs's next.config.js wrapper (source-map upload, extra
 * webpack instrumentation) to keep this a small, low-risk addition - just
 * capturing exceptions, not full tracing/replay.
 *
 * Privacy (mirrors apps/api/src/common/sentry.ts): `sendDefaultPii: false`,
 * plus the current page URL and every navigation/fetch/XHR breadcrumb has its
 * query string and hash stripped before it leaves the browser - a patient
 * search (`/patients?search=Jane+Doe`) or a tenant lookup must not turn into
 * a name sitting in Sentry. Only the pathname is kept.
 */
let initialized = false

function stripQuery(url: string): string {
  try {
    const u = new URL(url, window.location.origin)
    return u.origin + u.pathname
  } catch {
    return url.split('?')[0].split('#')[0]
  }
}

export function initSentryClient(): void {
  if (initialized) return
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()
  if (!dsn) return
  initialized = true
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.url) event.request.url = stripQuery(event.request.url)
      delete (event.request as { query_string?: unknown } | undefined)?.query_string
      delete event.user
      return event
    },
    beforeBreadcrumb(breadcrumb) {
      const data = breadcrumb.data as Record<string, unknown> | undefined
      if (data) {
        if (typeof data.url === 'string') data.url = stripQuery(data.url)
        if (typeof data.to === 'string') data.to = stripQuery(data.to)
        if (typeof data.from === 'string') data.from = stripQuery(data.from)
      }
      return breadcrumb
    },
  })
}

export { Sentry }
