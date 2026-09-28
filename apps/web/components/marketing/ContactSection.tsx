'use client'
import { useEffect, useRef, useState } from 'react'
import Script from 'next/script'
import { Reveal } from '@/components/motion/Reveal'
import { Stagger, StaggerItem } from '@/components/motion/Stagger'
import { MagneticButton } from '@/components/motion/MagneticButton'
import { contactApi, ApiError } from '@/lib/contact'

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string
      reset: (widgetId: string) => void
    }
  }
}

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 6-10 7L2 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function PinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

const CONTACT_EMAIL = 'info@Oudtechnologies.com'

interface ContactSectionProps {
  /** Read server-side (not NEXT_PUBLIC_-prefixed) and passed down - see app/(marketing)/contact/page.tsx. */
  turnstileSiteKey: string
}

export function ContactSection({ turnstileSiteKey }: ContactSectionProps) {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', message: '', website: '' })
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [scriptLoaded, setScriptLoaded] = useState(false)
  const renderedAtRef = useRef(Date.now())
  const widgetContainerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!scriptLoaded || !turnstileSiteKey || !window.turnstile || !widgetContainerRef.current) return
    widgetIdRef.current = window.turnstile.render(widgetContainerRef.current, {
      sitekey: turnstileSiteKey,
      callback: (token: string) => setTurnstileToken(token),
      'expired-callback': () => setTurnstileToken(''),
      'error-callback': () => setTurnstileToken(''),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptLoaded, turnstileSiteKey])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setStatus('sending')
    try {
      await contactApi.submit({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        message: form.message,
        website: form.website,
        turnstileToken,
        formRenderedAt: renderedAtRef.current,
      })
      setStatus('sent')
      setForm({ firstName: '', lastName: '', email: '', phone: '', message: '', website: '' })
    } catch (err) {
      setStatus('error')
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setTurnstileToken('')
      if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current)
    }
  }

  return (
    <section className="max-w-6xl mx-auto px-6 py-16 sm:py-24 grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
      />

      <Reveal direction="left">
        <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 leading-tight">
          Book a free consultation with our workflow
        </h2>
        <p className="text-gray-500 mt-5 max-w-md">
          Have questions or need assistance? We&apos;re here to help. Whether you need support, want to learn more
          about Oudmed, or have a general inquiry, feel free to reach out to us.
        </p>

        <div className="mt-8 space-y-4 text-gray-700">
          <a href="tel:+2348052952194" className="flex items-center gap-3 hover:text-primary transition">
            <PhoneIcon /> +234 805 295 2194
          </a>
          <a href={`mailto:${CONTACT_EMAIL}`} className="flex items-center gap-3 hover:text-primary transition">
            <MailIcon /> {CONTACT_EMAIL}
          </a>
          <p className="flex items-center gap-3">
            <PinIcon /> Port Harcourt, Nigeria
          </p>
        </div>
      </Reveal>

      <Reveal direction="right">
        <form
          onSubmit={handleSubmit}
          className="rounded-3xl border-2 border-primary p-6 sm:p-8 space-y-4"
        >
          <h3 className="text-xl font-bold text-gray-900">Contact Us</h3>

          {/* Honeypot - off-screen (not display:none) so a bot that only skips
              hidden/invisible fields by computed style still fills this one. */}
          <input
            type="text"
            name="website"
            value={form.website}
            onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
          />

          <Stagger className="grid grid-cols-2 gap-4" stagger={0.06}>
            <StaggerItem>
              <label className="block text-sm font-medium text-gray-900 mb-1.5">First name</label>
              <input
                required
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                placeholder="Enter first name"
                className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </StaggerItem>
            <StaggerItem>
              <label className="block text-sm font-medium text-gray-900 mb-1.5">Last name</label>
              <input
                required
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                placeholder="Enter last name"
                className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </StaggerItem>
            <StaggerItem>
              <label className="block text-sm font-medium text-gray-900 mb-1.5">Email address*</label>
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="Enter email address"
                className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </StaggerItem>
            <StaggerItem>
              <label className="block text-sm font-medium text-gray-900 mb-1.5">Phone number*</label>
              <input
                required
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="Phone number"
                className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </StaggerItem>
          </Stagger>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1.5">Tell us how we can help.</label>
            <textarea
              required
              value={form.message}
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
              placeholder="Enter your message"
              rows={5}
              maxLength={4000}
              className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          <div ref={widgetContainerRef} />
          {!turnstileSiteKey && (
            <p className="text-xs text-amber-600">
              Turnstile site key not configured - submissions will be rejected until TURNSTILE_SITE_KEY is set.
            </p>
          )}

          <MagneticButton fullWidth strength={6}>
            <button
              type="submit"
              disabled={!turnstileToken || status === 'sending'}
              className="w-full rounded-full text-white font-semibold py-3.5 hover:brightness-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(90deg, #2563EB 0%, #3366E3 100%)' }}
            >
              {status === 'sending' ? 'Sending...' : 'Submit inquiry'}
            </button>
          </MagneticButton>
          {status === 'sent' && (
            <p className="text-xs text-emerald-600 text-center">Thanks - we&apos;ll get back to you soon.</p>
          )}
          {status === 'error' && <p className="text-xs text-red-600 text-center">{error}</p>}
        </form>
      </Reveal>
    </section>
  )
}
