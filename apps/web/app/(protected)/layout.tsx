import type { Metadata } from 'next'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import AuthProvider from '@/components/AuthProvider'
import AppShell from '@/components/AppShell'

// Every page in this tree is a hospital's private records - patients, billing,
// staff. None of it is ever meant to be crawled or indexed, regardless of what
// the middleware's auth redirect would already do to an unauthenticated crawler.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
}

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.apiToken) redirect('/login')
  return (
    <AuthProvider session={session}>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  )
}
