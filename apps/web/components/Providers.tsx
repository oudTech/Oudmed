'use client'
import { QueryClient, QueryClientProvider, useIsFetching, useIsMutating } from '@tanstack/react-query'
import { SessionProvider, useSession } from 'next-auth/react'
import type { Session } from 'next-auth'
import { useEffect, useState } from 'react'
import { setAuthToken, SUBSCRIPTION_READ_ONLY_EVENT } from '@/lib/api'
import { FeedbackProvider, useToast } from '@/components/ui/feedback'
import { initSentryClient } from '@/lib/sentry-client'

initSentryClient() // no-op unless NEXT_PUBLIC_SENTRY_DSN is set; runs once on module load

function TokenSync() {
  const { data: session } = useSession()
  useEffect(() => {
    setAuthToken(session?.apiToken)
  }, [session?.apiToken])
  return null
}

/**
 * A blocked write reaches every role, not just the hospital admin who can fix
 * it - so this fires everywhere, not only on the Settings/Billing screen where
 * the admin would notice a more specific banner. One toast at a time (a burst
 * of blocked writes shouldn't stack a wall of identical toasts).
 */
function SubscriptionReadOnlyListener() {
  const toast = useToast()
  useEffect(() => {
    let last = 0
    const handler = () => {
      const now = Date.now()
      if (now - last < 5000) return
      last = now
      toast(
        "This hospital's subscription needs attention. Existing records remain visible; ask your admin to update billing to resume creating or editing records.",
        'error',
      )
    }
    window.addEventListener(SUBSCRIPTION_READ_ONLY_EVENT, handler)
    return () => window.removeEventListener(SUBSCRIPTION_READ_ONLY_EVENT, handler)
  }, [toast])
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
        <FeedbackProvider>
          <SubscriptionReadOnlyListener />
          {children}
        </FeedbackProvider>
      </QueryClientProvider>
    </SessionProvider>
  )
}
