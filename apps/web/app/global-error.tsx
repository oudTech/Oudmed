'use client'
import { useEffect } from 'react'
import { initSentryClient, Sentry } from '@/lib/sentry-client'

// The last-resort boundary: it replaces the root layout (so Providers.tsx,
// which normally does this init, never mounts) and must render its own
// <html>/<body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    initSentryClient()
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 32 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: '#6b7280', marginTop: 8 }}>The application hit an unexpected error.</p>
          {error.digest && <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 12, fontFamily: 'monospace' }}>Reference: {error.digest}</p>}
          <button
            onClick={reset}
            style={{ marginTop: 24, background: '#3366E3', color: '#fff', border: 0, borderRadius: 8, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
