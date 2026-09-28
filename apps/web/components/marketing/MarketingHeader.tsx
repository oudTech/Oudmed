'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact Us' },
]

export function MarketingHeader() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="relative z-20" style={{ borderBottom: '1px solid #C7CBD3' }}>
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/oudmed-logo.svg" alt="Oudmed" width={121} height={25} />

        <nav className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm font-medium transition ${
                  active ? 'text-primary' : 'text-gray-700 hover:text-primary'
                }`}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:brightness-95 transition"
          >
            Get Started
          </Link>
        </div>

        <button
          className="md:hidden p-1"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((o) => !o)}
        >
          {mobileOpen ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-white border-b border-gray-200 shadow-lg px-6 py-4">
          <nav className="flex flex-col gap-4">
            {NAV_LINKS.map((link) => {
              const active = pathname === link.href
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={`text-sm font-medium transition ${active ? 'text-primary' : 'text-gray-700'}`}
                >
                  {link.label}
                </Link>
              )
            })}
          </nav>
          <div className="flex flex-col gap-3 mt-5">
            <Link
              href="/login"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg bg-white border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 text-center hover:bg-gray-50 transition"
            >
              Login
            </Link>
            <Link
              href="/signup"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white text-center hover:brightness-95 transition"
            >
              Get Started
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
