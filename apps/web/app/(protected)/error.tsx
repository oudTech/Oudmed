'use client'
import { useEffect } from 'react'

export default function ProtectedError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error)
  }, [error])

  return (
    <div className="h-full flex flex-col items-center justify-center p-8 text-center">
      <h1 className="text-xl font-bold text-gray-900">Something went wrong</h1>
      <p className="text-sm text-gray-500 mt-2 max-w-sm">
        This screen hit an unexpected error. You can try again, or reload the page.
      </p>
      {error.digest && (
        <p className="text-xs text-gray-400 mt-3 font-mono">Reference: {error.digest}</p>
      )}
      <div className="flex gap-2 mt-6">
        <button
          onClick={reset}
          className="rounded-lg bg-primary text-white text-sm font-semibold px-4 py-2 hover:bg-[#2b58c9]"
        >
          Try again
        </button>
        <button
          onClick={() => (window.location.href = '/dashboard')}
          className="rounded-lg border border-gray-200 text-sm font-semibold px-4 py-2 text-gray-700 hover:bg-gray-50"
        >
          Back to dashboard
        </button>
      </div>
    </div>
  )
}
