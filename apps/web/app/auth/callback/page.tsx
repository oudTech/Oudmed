'use client'
import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { authApi } from '@/lib/authApi'
import { establishSession, HOME_PATH } from '@/lib/authFlow'

function CallbackInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [error, setError] = useState('')
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const ticket = params?.get('ticket')
    if (!ticket) {
      setError('This sign-in link is missing its token.')
      return
    }
    ;(async () => {
      try {
        const result = await authApi.redeemTicket(ticket)
        const ok = await establishSession(result.accessToken)
        if (!ok) {
          setError('Signed in, but the session could not be created. Try logging in.')
          return
        }
        router.replace(HOME_PATH)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'This sign-in link is invalid or has expired.')
      }
    })()
  }, [params, router])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center font-hanken bg-white px-6">
      {error ? (
        <div className="text-center max-w-sm">
          <h1 className="text-lg font-bold text-gray-900">Couldn&apos;t finish signing in</h1>
          <p className="text-sm text-gray-500 mt-2">{error}</p>
          <button
            onClick={() => router.replace('/login')}
            className="mt-6 text-sm text-[#0A89D3] hover:underline font-medium"
          >
            Go to sign in
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-gray-500">
          <span className="w-5 h-5 border-2 border-gray-300 border-t-primary rounded-full animate-spin" />
          <span className="text-sm">Setting up your workspace…</span>
        </div>
      )}
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <CallbackInner />
    </Suspense>
  )
}
