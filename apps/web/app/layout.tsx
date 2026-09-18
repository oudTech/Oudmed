import type { Metadata } from 'next'
import { Hanken_Grotesk } from 'next/font/google'
import './globals.css'
import Providers from '@/components/Providers'
import { auth } from '@/lib/auth'
import { ROOT_DOMAIN, APP_PROTOCOL } from '@/lib/tenant'

const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-hanken',
  display: 'swap',
})

const SITE_NAME = 'Oudmed'
const SITE_DESCRIPTION =
  'Multi-tenant hospital management system for African healthcare providers - patient records, scheduling, pharmacy, billing and claims in one place.'

// Every page not otherwise overridden inherits this. Only the apex ("/") and
// /signup are meant to be found by search engines - every auth/utility page
// and everything under (protected) sets its own noindex via a small layout.tsx
// (see components/onboarding-style pattern: those pages are 'use client', and
// Next's metadata export only works from a server component).
export const metadata: Metadata = {
  metadataBase: new URL(`${APP_PROTOCOL}://${ROOT_DOMAIN}`),
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  openGraph: {
    siteName: SITE_NAME,
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
  },
}

// Only facts that are actually true of this codebase - name and URL. No address,
// phone, logo or social profiles are claimed, since none are configured anywhere.
const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE_NAME,
  url: `${APP_PROTOCOL}://${ROOT_DOMAIN}`,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  return (
    <html lang="en" className={hanken.variable}>
      <body className="font-hanken">
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  )
}
