import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import PlatformShell from '@/components/platform/PlatformShell'

// The Super Admin dashboard is OudHealth's own operational tooling, never
// meant to be crawled or indexed - same stance as the hospital (protected) tree.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
}

export default async function PlatformDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.isPlatform || !session.platformToken) redirect('/platform/login')
  return <PlatformShell initialToken={session.platformToken}>{children}</PlatformShell>
}
