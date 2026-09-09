'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import AuthShell from '@/components/auth/AuthShell'
import { FormError, SubmitButton } from '@/components/auth/fields'
import { authApi, ApiError } from '@/lib/authApi'

export default function VerifyEmailPage() {
  const router = useRouter()
  const [pendingToken, setPendingToken] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [resent, setResent] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const t = sessionStorage.getItem('oud_pending_token')
    if (!t) {
      router.replace('/signup')
      return
    }
    setPendingToken(t)
    setEmail(sessionStorage.getItem('oud_pending_email') ?? '')
  }, [router])

  useEffect(() => {
    if (cooldown <= 0) return
    timer.current = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [cooldown])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!pendingToken) return
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code')

    setLoading(true)
    try {
      const res = await authApi.verifyEmail({ pendingToken, code })
      sessionStorage.setItem('oud_pending_token', res.pendingToken)
      router.replace('/onboarding')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code did not work')
      setLoading(false)
    }
  }

  async function handleResend() {
    setError('')
    setResent(false)
    if (!pendingToken) return
    try {
      await authApi.resendVerification({ pendingToken })
      setResent(true)
      setCooldown(45)
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setCooldown(45)
      setError(err instanceof Error ? err.message : 'Could not resend the code')
    }
  }

  return (
    <AuthShell>
      <h1 className="text-2xl font-bold text-gray-900 text-center">Enter verification code</h1>
      <p className="text-sm text-gray-500 text-center mt-2 max-w-sm mx-auto">
        We&apos;ve sent a confirmation code{email ? ` to ${email}` : ' to your email address'}. Enter
        it below to confirm your email address.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4" noValidate>
        <div>
          <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1.5">
            Enter code here
          </label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="w-full border border-gray-200 rounded-lg px-4 py-3 text-center text-2xl font-semibold tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            autoFocus
          />
        </div>

        <FormError>{error}</FormError>
        {resent && !error && (
          <p className="text-sm text-green-600 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
            A new code is on its way.
          </p>
        )}

        <SubmitButton loading={loading}>Confirm</SubmitButton>
      </form>

      <p className="text-center text-sm text-gray-700 mt-6">
        Did not receive a code?{' '}
        <button
          type="button"
          onClick={handleResend}
          disabled={cooldown > 0}
          className="text-[#0A89D3] hover:underline font-medium disabled:no-underline disabled:text-gray-400"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend'}
        </button>
      </p>
    </AuthShell>
  )
}
