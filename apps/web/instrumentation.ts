// Next.js's own instrumentation hook (stable since 14.0, no config flag needed).
// Handles server-side error capture that never reaches app/error.tsx - route
// handlers, server components, middleware. No-op unless SENTRY_DSN is set.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const dsn = process.env.SENTRY_DSN?.trim()
    if (!dsn) return
    const Sentry = await import('@sentry/nextjs')
    Sentry.init({ dsn, environment: process.env.NODE_ENV ?? 'development', tracesSampleRate: 0 })
  }
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
) {
  if (!process.env.SENTRY_DSN?.trim()) return
  const Sentry = await import('@sentry/nextjs')
  Sentry.captureException(error, { extra: { path: request.path, method: request.method } })
}
