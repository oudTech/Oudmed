import * as Sentry from '@sentry/node';

/**
 * Error tracking, off by default. Set SENTRY_DSN to turn it on - with it unset,
 * every Sentry.* call below is a documented no-op (the SDK is designed this
 * way), so this is safe to import and call unconditionally everywhere,
 * including in tests, without needing to mock it.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0,
  });
}

export { Sentry };
