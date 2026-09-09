'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import AuthShell from '@/components/auth/AuthShell'
import {
  TextField,
  PasswordField,
  FormError,
  SubmitButton,
  passwordScore,
} from '@/components/auth/fields'
import { authApi, ApiError } from '@/lib/authApi'
import { apexUrl } from '@/lib/tenant'

export default function SignupPage() {
  const router = useRouter()
  const [form, setForm] = useState({ fullName: '', email: '', password: '' })
  const [accepted, setAccepted] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }))

  function validate() {
    const next: Record<string, string> = {}
    if (form.fullName.trim().length < 2) next.fullName = 'Enter your full name'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Enter a valid email address'
    if (form.password.length < 8 || passwordScore(form.password) < 2)
      next.password = 'Use at least 8 characters, with a letter and a number'
    if (!accepted) next.accepted = 'You must accept the terms to continue'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!validate()) return
    setLoading(true)
    try {
      const { pendingToken } = await authApi.register({
        fullName: form.fullName.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        acceptedTerms: accepted,
      })
      sessionStorage.setItem('oud_pending_token', pendingToken)
      sessionStorage.setItem('oud_pending_email', form.email.trim().toLowerCase())
      router.push('/verify-email')
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create your account')
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <h1 className="text-2xl font-bold text-gray-900 text-center">Create your hospital</h1>
      <p className="text-sm text-gray-500 text-center mt-1.5">
        Start with your details. You&apos;ll set up the hospital next.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4 mt-8" noValidate>
        <TextField
          label="Full name"
          required
          autoComplete="name"
          placeholder="Amara Johnson"
          value={form.fullName}
          onChange={set('fullName')}
          error={errors.fullName}
        />
        <TextField
          label="Email"
          required
          type="email"
          autoComplete="email"
          placeholder="you@hospital.com"
          value={form.email}
          onChange={set('email')}
          error={errors.email}
        />
        <PasswordField
          label="Password"
          required
          showMeter
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={form.password}
          onChange={set('password')}
          error={errors.password}
        />

        <label className="flex items-start gap-2.5 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
          />
          <span>
            I agree to the{' '}
            <a href={apexUrl('/legal/terms')} className="text-[#0A89D3] hover:underline">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href={apexUrl('/legal/privacy')} className="text-[#0A89D3] hover:underline">
              Privacy Policy
            </a>
          </span>
        </label>
        {errors.accepted && <p className="text-xs text-red-500 -mt-2">{errors.accepted}</p>}

        <FormError>{formError}</FormError>

        <SubmitButton loading={loading}>Create account</SubmitButton>
      </form>

      <p className="text-center text-sm text-gray-700 mt-6">
        Already have a hospital on Oudmed?{' '}
        <a href={apexUrl('/')} className="text-[#0A89D3] hover:underline font-medium">
          Sign in
        </a>
      </p>
    </AuthShell>
  )
}
