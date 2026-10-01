import * as Sentry from '@sentry/node';

/**
 * Error tracking, off by default. Set SENTRY_DSN to turn it on - with it unset,
 * every Sentry.* call below is a documented no-op (the SDK is designed this
 * way), so this is safe to import and call unconditionally everywhere,
 * including in tests, without needing to mock it.
 *
 * Privacy (patient data rule - this app holds PHI, nothing patient-identifying
 * or free-text clinical may leave the process via telemetry):
 *   - `sendDefaultPii: false` - the SDK never auto-attaches request IP, cookies,
 *     or headers.
 *   - `beforeSend` additionally strips anything that could still carry it:
 *     the full request body (clinical notes, patient names, payment details -
 *     anything a request payload could hold), the Authorization/Cookie
 *     headers (live JWTs), and `event.user` (we never call `Sentry.setUser`,
 *     but this is a hard backstop in case a future change does).
 *   - What IS sent, deliberately, via `AllExceptionsFilter`'s tags: tenantId,
 *     userId (an opaque UUID, not a name/email), role, the route, the request
 *     id, and the exception's own message/stack - enough to triage an
 *     incident without ever seeing what the request was actually about.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['Authorization'];
          delete event.request.headers['cookie'];
          delete event.request.headers['Cookie'];
        }
      }
      delete event.user;
      return event;
    },
  });
}

export { Sentry };
