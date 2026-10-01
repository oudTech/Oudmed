'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AuthShell from '@/components/auth/AuthShell'
import { TextField, PasswordField, FormError, SubmitButton } from '@/components/auth/fields'
import { authApi, ApiError, type TenantPublic } from '@/lib/authApi'
import { establishSession, HOME_PATH } from '@/lib/authFlow'
import { currentSubdomain, tenantUrl, ROOT_DOMAIN } from '@/lib/tenant'

/** Apex domain: no subdomain yet - let the visitor find their hospital's own address. */
function FindHospital() {
  const [slug, setSlug] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function go(e: React.FormEvent) {
    e.preventDefault()
    const s = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!s) return
    setError('')
    setLoading(true)
    try {
      // Verify the hospital actually exists before the address bar ever changes.
      await authApi.resolveTenant(s)
      window.location.href = tenantUrl(s, '/login')
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'TENANT_SUSPENDED'
          ? 'This hospital account is suspended. Contact support for help.'
          : "We couldn't find a hospital at that address. Check it and try again.",
      )
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <h1 className="text-2xl font-bold text-gray-900 text-center">Go to your hospital</h1>
      <p className="text-sm text-gray-500 text-center mt-1.5">
        Sign in at your hospital&apos;s own address.
      </p>

      <form onSubmit={go} className="mt-8">
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Hospital address</label>
        <div
          className={`flex items-stretch border rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-primary focus-within:border-transparent ${error ? 'border-red-300' : 'border-gray-200'}`}
        >
          <input
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value)
              if (error) setError('')
            }}
            placeholder="your-hospital"
            className="flex-1 px-4 py-2.5 text-sm focus:outline-none"
            autoFocus
          />
          <span className="px-3 flex items-center text-sm text-gray-400 bg-gray-50 border-l border-gray-200 whitespace-nowrap">
            .{ROOT_DOMAIN.replace(/:\d+$/, '')}
          </span>
        </div>
        {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
        <div className="mt-4">
          <SubmitButton loading={loading}>Continue</SubmitButton>
        </div>
      </form>

      <div className="relative my-5">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-white px-3 text-gray-400">New to Oudmed?</span>
        </div>
      </div>

      <Link
        href="/signup"
        className="block text-center border border-gray-200 rounded-lg py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
      >
        Create a hospital
      </Link>
    </AuthShell>
  )
}

/** Tenant subdomain: sign in to this specific hospital's workspace. */
function TenantLogin({ slug }: { slug: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const [tenant, setTenant] = useState<TenantPublic | null>(null)
  const [unknownTenant, setUnknownTenant] = useState(false)
  const [suspended, setSuspended] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(params?.get('reason') === 'expired' ? 'Your session expired. Please sign in again.' : '')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    authApi
      .resolveTenant(slug)
      .then(setTenant)
      .catch((err) => {
        if (err instanceof ApiError && err.code === 'TENANT_SUSPENDED') setSuspended(true)
        else setUnknownTenant(true)
      })
  }, [slug])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
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

  if (suspended) {
    return (
      <AuthShell>
        <h1 className="text-2xl font-bold text-gray-900 text-center">Account suspended</h1>
        <p className="text-sm text-gray-500 text-center mt-2">
          This hospital&apos;s account has been suspended. Contact support for help getting it
          reactivated.
        </p>
        <a
          href="mailto:support@oudhealth.app?subject=Suspended%20hospital%20account"
          className="block text-center mt-6 rounded-lg bg-primary py-2.5 text-sm font-medium text-white hover:opacity-90 transition"
        >
          Contact support
        </a>
      </AuthShell>
    )
  }

  if (unknownTenant) {
    return (
      <AuthShell>
        <h1 className="text-2xl font-bold text-gray-900 text-center">Hospital not found</h1>
        <p className="text-sm text-gray-500 text-center mt-2">
          This address doesn&apos;t match a hospital on Oudmed. Check the URL, or create a new one.
        </p>
        <a
          href="/signup"
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

function LoginInner() {
  const [slug, setSlug] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    setSlug(currentSubdomain())
    setChecked(true)
  }, [])

  if (!checked) return null
  return slug ? <TenantLogin slug={slug} /> : <FindHospital />
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  )
}
