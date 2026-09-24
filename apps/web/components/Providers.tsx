'use client'
import { QueryClient, QueryClientProvider, useIsFetching, useIsMutating } from '@tanstack/react-query'
import { SessionProvider, useSession } from 'next-auth/react'
import type { Session } from 'next-auth'
import { useEffect, useState } from 'react'
import { setAuthToken } from '@/lib/api'
import { FeedbackProvider } from '@/components/ui/feedback'
import { initSentryClient } from '@/lib/sentry-client'

initSentryClient() // no-op unless NEXT_PUBLIC_SENTRY_DSN is set; runs once on module load

function TokenSync() {
  const { data: session } = useSession()
  useEffect(() => {
    setAuthToken(session?.apiToken)
  }, [session?.apiToken])
  return null
}

/** A thin top progress bar while any query or mutation is in flight. */
function NetworkIndicator() {
  const busy = useIsFetching() + useIsMutating() > 0
  return (
    <div
      aria-hidden
      className={`fixed top-0 left-0 right-0 h-0.5 z-[1000] bg-primary transition-opacity duration-200 ${
        busy ? 'opacity-100 animate-pulse' : 'opacity-0'
      }`}
    />
  )
}

export default function Providers({
  session,
  children,
}: {
  session: Session | null
  children: React.ReactNode
}) {
  const [qc] = useState(() => new QueryClient())
  return (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <TokenSync />
        <NetworkIndicator />
        <FeedbackProvider>{children}</FeedbackProvider>
      </QueryClientProvider>
    </SessionProvider>
  )
}
