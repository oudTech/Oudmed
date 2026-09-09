'use client'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AuthShell from '@/components/auth/AuthShell'
import { PasswordField, FormError, SubmitButton, passwordScore } from '@/components/auth/fields'
import { authApi } from '@/lib/authApi'
import { establishSession, HOME_PATH } from '@/lib/authFlow'

function ResetInner() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params?.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    const next: Record<string, string> = {}
    if (password.length < 8 || passwordScore(password) < 2)
      next.password = 'Use at least 8 characters, with a letter and a number'
    if (confirm !== password) next.confirm = 'Passwords do not match'
    setErrors(next)
    if (Object.keys(next).length) return

    setLoading(true)
    try {
      const result = await authApi.resetPassword({ token, password })
      await establishSession(result.accessToken)
      router.replace(HOME_PATH)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not reset your password')
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <AuthShell>
        <h1 className="text-2xl font-bold text-gray-900 text-center">Invalid reset link</h1>
        <p className="text-sm text-gray-500 text-center mt-2">
          This link is missing or malformed. Request a new one.
        </p>
        <p className="text-center text-sm mt-6">
          <Link href="/forgot-password" className="text-[#0A89D3] hover:underline font-medium">
            Request a new link
          </Link>
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <h1 className="text-2xl font-bold text-gray-900 text-center">Choose a new password</h1>
      <form onSubmit={handleSubmit} className="space-y-4 mt-8" noValidate>
        <PasswordField
          label="New password"
          required
          showMeter
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <PasswordField
          label="Confirm password"
          required
          autoComplete="new-password"
          placeholder="Re-enter your password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
        />
        <FormError>{formError}</FormError>
        <SubmitButton loading={loading}>Reset password</SubmitButton>
      </form>
    </AuthShell>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetInner />
    </Suspense>
  )
}
