import type { Metadata } from 'next'

// /auth/callback carries a one-time login ticket in the query string and does
// nothing but redirect - never index or cache it.
export const metadata: Metadata = {
  title: 'Signing you in',
  robots: { index: false, follow: false, nocache: true },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
