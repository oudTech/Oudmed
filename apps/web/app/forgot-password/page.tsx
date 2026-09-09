'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AuthShell from '@/components/auth/AuthShell'
import { TextField, FormError, SubmitButton } from '@/components/auth/fields'
import { authApi } from '@/lib/authApi'
import { currentSubdomain } from '@/lib/tenant'

export default function ForgotPasswordPage() {
  const [slug, setSlug] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    setSlug(currentSubdomain())
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('Enter a valid email address')
    if (!slug) return setError('Open this page from your hospital address.')
    setLoading(true)
    try {
      await authApi.forgotPassword({ tenantSlug: slug, email: email.trim().toLowerCase() })
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reset link')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <h1 className="text-2xl font-bold text-gray-900 text-center">Reset your password</h1>

      {sent ? (
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            If an account exists for <span className="font-medium">{email}</span>, you&apos;ll receive
            a link to reset your password shortly.
          </p>
          <Link
            href="/login"
            className="inline-block mt-6 text-sm text-[#0A89D3] hover:underline font-medium"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-500 text-center mt-2">
            Enter your email and we&apos;ll send you a reset link.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4 mt-8" noValidate>
            <TextField
              label="Email"
              required
              type="email"
              autoComplete="email"
              placeholder="you@hospital.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <FormError>{error}</FormError>
            <SubmitButton loading={loading}>Send reset link</SubmitButton>
          </form>
          <p className="text-center text-sm text-gray-700 mt-6">
            <Link href="/login" className="text-[#0A89D3] hover:underline font-medium">
              Back to sign in
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  )
}
