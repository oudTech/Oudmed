import type { Metadata } from 'next'

// login/page.tsx is 'use client' (uses useSearchParams), so metadata has to be
// declared from this sibling server-component layout instead. This page exists
// separately per hospital subdomain with no unique content of its own, so it is
// excluded from search rather than indexed thousands of times over.
export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
