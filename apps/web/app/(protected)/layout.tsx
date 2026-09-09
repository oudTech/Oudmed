import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import AuthProvider from '@/components/AuthProvider'
import AppShell from '@/components/AppShell'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.apiToken) redirect('/login')
  return (
    <AuthProvider session={session}>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  )
}
