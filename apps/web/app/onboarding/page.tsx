'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TextField, SelectField, FormError } from '@/components/auth/fields'
import { authApi } from '@/lib/authApi'
import { COUNTRIES } from '@/lib/countries'

const FACILITY_TYPES = [
  { value: 'HOSPITAL', label: 'Hospital' },
  { value: 'CLINIC', label: 'Clinic' },
  { value: 'SPECIALIST_CENTER', label: 'Specialist centre' },
  { value: 'DIAGNOSTIC_LAB', label: 'Diagnostic lab' },
  { value: 'PHARMACY', label: 'Pharmacy' },
]

const SIZE_BANDS = ['1-10', '11-50', '51-200', '201-500', '500+']

export default function OnboardingPage() {
  const router = useRouter()
  const [pendingToken, setPendingToken] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    facilityType: 'HOSPITAL',
    country: '',
    staffSizeBand: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const t = sessionStorage.getItem('oud_pending_token')
    if (!t) {
      router.replace('/signup')
      return
    }
    setPendingToken(t)
  }, [router])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    const next: Record<string, string> = {}
    if (form.name.trim().length < 2) next.name = 'Enter your hospital name'
    if (!form.country) next.country = 'Select a country'
    setErrors(next)
    if (Object.keys(next).length || !pendingToken) return

    setLoading(true)
    try {
      const { redirectUrl } = await authApi.createTenant(pendingToken, {
        name: form.name.trim(),
        facilityType: form.facilityType,
        country: form.country,
        staffSizeBand: form.staffSizeBand || undefined,
      })
      sessionStorage.removeItem('oud_pending_token')
      sessionStorage.removeItem('oud_pending_email')
      // Hand off to the new tenant subdomain (full navigation, not client routing).
      window.location.href = redirectUrl
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create your workspace')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col font-hanken bg-white">
      <header className="px-8 sm:px-14 pt-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/oudmed-logo.svg" alt="Oudmed" className="h-7 w-auto" />
      </header>

      <main className="flex-1 flex items-start sm:items-center">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-2xl mx-auto px-8 sm:px-14 py-12"
          noValidate
        >
          <h1 className="text-[1.75rem] font-bold leading-snug">
            <span className="text-primary">Welcome to Oudmed.</span> Tell us about your hospital so
            we can help you get started
          </h1>

          <div className="mt-10 space-y-5">
            <TextField
              label="Hospital name"
              required
              placeholder="e.g. St. Mary's Hospital"
              value={form.name}
              onChange={set('name')}
              error={errors.name}
              autoFocus
              hint="Your workspace address is generated from this. You can change it later in Settings."
            />

            <div className="grid sm:grid-cols-2 gap-5">
              <SelectField label="Type" required value={form.facilityType} onChange={set('facilityType')}>
                {FACILITY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </SelectField>

              <SelectField
                label="Country"
                required
                value={form.country}
                onChange={set('country')}
                error={errors.country}
              >
                <option value="" disabled>
                  Select a country
                </option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </SelectField>
            </div>

            <SelectField
              label="How many staff will use Oudmed?"
              value={form.staffSizeBand}
              onChange={set('staffSizeBand')}
            >
              <option value="">Prefer not to say</option>
              {SIZE_BANDS.map((b) => (
                <option key={b} value={b}>
                  {b} people
                </option>
              ))}
            </SelectField>

            <FormError>{formError}</FormError>
          </div>

          <div className="flex justify-end mt-10">
            <button
              type="submit"
              disabled={loading}
              className="bg-primary text-white rounded-lg px-8 py-2.5 text-sm font-semibold hover:bg-[#2b58c9] transition disabled:opacity-60"
            >
              {loading ? 'Creating…' : 'Continue'}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
