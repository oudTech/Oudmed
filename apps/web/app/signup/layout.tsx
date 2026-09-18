import type { Metadata } from 'next'

// signup/page.tsx is 'use client' (form state), so metadata is declared here.
export const metadata: Metadata = {
  title: 'Create a hospital',
  description:
    'Set up a new hospital workspace on Oudmed - patient records, scheduling, pharmacy, billing and claims in one place.',
  alternates: { canonical: '/signup' },
  robots: { index: true, follow: true },
}

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children
}
