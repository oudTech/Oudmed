import type { Metadata } from 'next'

// Reached via a one-time emailed verification code/link - never index or cache it.
export const metadata: Metadata = {
  title: 'Verify your email',
  robots: { index: false, follow: false, nocache: true },
}

export default function VerifyEmailLayout({ children }: { children: React.ReactNode }) {
  return children
}
