'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import AuthShell from '@/components/auth/AuthShell'
import { TextField, PasswordField, FormError, SubmitButton } from '@/components/auth/fields'

export default function PlatformLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await signIn('platform', { email: email.trim().toLowerCase(), password, redirect: false })
    if (res?.error) {
      setError('Invalid email or password')
      setLoading(false)
      return
    }
    router.replace('/platform')
  }

  return (
    <AuthShell>
      <h1 className="text-2xl font-bold text-gray-900 text-center">Platform sign in</h1>
      <p className="text-sm text-gray-500 text-center mt-1">For OudHealth operators only.</p>

      <form onSubmit={handleSubmit} className="space-y-4 mt-8" noValidate>
        <TextField
          label="Email"
          required
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          label="Password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError>{error}</FormError>
        <SubmitButton loading={loading}>Sign in</SubmitButton>
      </form>
    </AuthShell>
  )
}
