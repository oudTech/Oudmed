'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AuthShell from '@/components/auth/AuthShell'
import { TextField, PasswordField, FormError, SubmitButton } from '@/components/auth/fields'
import { authApi, ApiError, type TenantPublic } from '@/lib/authApi'
import { establishSession, HOME_PATH } from '@/lib/authFlow'
import { currentSubdomain, apexUrl } from '@/lib/tenant'

function LoginInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [slug, setSlug] = useState<string | null>(null)
  const [tenant, setTenant] = useState<TenantPublic | null>(null)
  const [unknownTenant, setUnknownTenant] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(params?.get('reason') === 'expired' ? 'Your session expired. Please sign in again.' : '')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const s = currentSubdomain()
    setSlug(s)
    if (!s) {
      setUnknownTenant(true)
      return
    }
    authApi
      .resolveTenant(s)
      .then(setTenant)
      .catch(() => setUnknownTenant(true))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!slug) return
    setError('')
    setLoading(true)
    try {
      const result = await authApi.login({ tenantSlug: slug, email: email.trim().toLowerCase(), password })
      const ok = await establishSession(result.accessToken)
      if (!ok) {
        setError('Sign-in failed. Please try again.')
        setLoading(false)
        return
      }
      router.replace(params?.get('next') || HOME_PATH)
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED'
          ? 'Please confirm your email address. We just sent you a code.'
          : err instanceof ApiError && err.code === 'INVALID_CREDENTIALS'
            ? 'Invalid email or password'
            : err instanceof Error
              ? err.message
              : 'Could not sign you in',
      )
      setLoading(false)
    }
  }

  if (unknownTenant) {
    return (
      <AuthShell>
        <h1 className="text-2xl font-bold text-gray-900 text-center">Hospital not found</h1>
        <p className="text-sm text-gray-500 text-center mt-2">
          This address doesn&apos;t match a hospital on Oudmed. Check the URL, or create a new one.
        </p>
        <a
          href={apexUrl('/signup')}
          className="block text-center mt-6 text-sm text-[#0A89D3] hover:underline font-medium"
        >
          Create a hospital
        </a>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      {tenant?.name ? (
        <p className="text-center text-sm font-medium text-primary mb-1">{tenant.name}</p>
      ) : null}
      <h1 className="text-2xl font-bold text-gray-900 text-center">Login to your Account</h1>

      <form onSubmit={handleSubmit} className="space-y-4 mt-8" noValidate>
        <TextField
          label="Email"
          required
          type="email"
          autoComplete="email"
          placeholder="Enter email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div>
          <PasswordField
            label="Password"
            required
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="flex justify-end mt-1.5">
            <Link href="/forgot-password" className="text-xs text-[#FF3D00] hover:text-orange-600">
              Forgot password?
            </Link>
          </div>
        </div>

        <FormError>{error}</FormError>

        <SubmitButton loading={loading || (!tenant && !unknownTenant)}>Login</SubmitButton>
      </form>
    </AuthShell>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  )
}
