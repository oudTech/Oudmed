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
 *     headers (live JWTs), the request URL's query string (a patient search
 *     like `GET /patients?search=Jane+Doe` is a query param, not a path
 *     segment), and `event.user` (we never call `Sentry.setUser`, but this is
 *     a hard backstop in case a future change does).
 *   - `beforeBreadcrumb` strips the same query string from any breadcrumb
 *     that carries a URL (an http/fetch breadcrumb logged before the error).
 *   - What IS sent, deliberately, via `AllExceptionsFilter`'s tags: tenantId,
 *     userId (an opaque UUID, not a name/email), role, the route (path only),
 *     the request id, and the exception's own message/stack - enough to
 *     triage an incident without ever seeing what the request was actually
 *     about.
 */
export function stripQuery(url: string): string {
  return url.split('?')[0].split('#')[0];
}

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
        delete (event.request as { query_string?: unknown }).query_string;
        if (event.request.url) event.request.url = stripQuery(event.request.url);
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
    beforeBreadcrumb(breadcrumb) {
      const data = breadcrumb.data as Record<string, unknown> | undefined;
      if (data && typeof data.url === 'string') data.url = stripQuery(data.url);
      return breadcrumb;
    },
  });
}

export { Sentry };
