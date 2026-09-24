'use client'
import { useEffect } from 'react'
import { Sentry } from '@/lib/sentry-client'

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error)
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center font-hanken bg-white">
      <h1 className="text-xl font-bold text-gray-900">Something went wrong</h1>
      <p className="text-sm text-gray-500 mt-2">Please try again.</p>
      {error.digest && <p className="text-xs text-gray-400 mt-3 font-mono">Reference: {error.digest}</p>}
      <button
        onClick={reset}
        className="mt-6 rounded-lg bg-primary text-white text-sm font-semibold px-4 py-2 hover:bg-[#2b58c9]"
      >
        Try again
      </button>
    </div>
  )
}
