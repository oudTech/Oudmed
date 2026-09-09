import type { Metadata } from 'next'
import { Hanken_Grotesk } from 'next/font/google'
import './globals.css'
import Providers from '@/components/Providers'
import { auth } from '@/lib/auth'

const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-hanken',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Oudmed',
  description: 'Hospital Management System',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  return (
    <html lang="en" className={hanken.variable}>
      <body className="font-hanken">
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  )
}
