import type { Metadata } from 'next'

// This page is only ever reached via a one-time emailed link carrying a reset
// token in the query string - never index or cache it.
export const metadata: Metadata = {
  title: 'Choose a new password',
  robots: { index: false, follow: false, nocache: true },
}

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children
}
