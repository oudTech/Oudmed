'use client'
import { useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { setPlatformAuthToken } from '@/lib/platform-api'

const INACTIVE = '#69768F'

function OverviewIcon({ color = INACTIVE }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="12" width="8" height="9" rx="1.5" /><rect x="3" y="15" width="8" height="6" rx="1.5" />
    </svg>
  )
}
function HospitalIcon({ color = INACTIVE }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <path d="M4 21V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14" strokeLinecap="round" />
      <path d="M9 21v-4h6v4M12 7v6M9 10h6" strokeLinecap="round" />
    </svg>
  )
}
function SubscriptionIcon({ color = INACTIVE }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5c0-1.4 1.2-2 2.5-2s2.5.7 2.5 2-1.2 1.7-2.5 2-2.5.7-2.5 2 1.2 2 2.5 2 2.5-.6 2.5-2" strokeLinecap="round" />
    </svg>
  )
}
function AnalyticsIcon({ color = INACTIVE }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <path d="M4 20V10M12 20V4M20 20v-7" strokeLinecap="round" />
    </svg>
  )
}
function SettingsIcon({ color = INACTIVE }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  )
}
function LogoutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const NAV = [
  { href: '/platform', label: 'Overview', Icon: OverviewIcon },
  { href: '/platform/hospitals', label: 'All Hospitals', Icon: HospitalIcon },
  { href: '/platform/subscriptions', label: 'Subscriptions', Icon: SubscriptionIcon },
  { href: '/platform/analytics', label: 'Analytics', Icon: AnalyticsIcon },
  { href: '/platform/settings', label: 'Settings', Icon: SettingsIcon },
]

export default function PlatformShell({
  initialToken,
  children,
}: {
  /**
   * The token as already verified server-side by (dashboard)/layout.tsx's own
   * `auth()` call. Applied synchronously below (not only from the `useEffect`)
   * because useSession()'s client-side refetch after signIn() is asynchronous -
   * without this, a child page's first query can fire with no Authorization
   * header at all, get a 401, and the axios interceptor immediately signs the
   * brand-new session back out again ("logged in and logged out immediately").
   */
  initialToken: string
  children: React.ReactNode
}) {
  // Runs during render, before React mounts any child effect (including a
  // child page's first useQuery) - see the comment above.
  if (typeof window !== 'undefined') setPlatformAuthToken(initialToken)

  const { data: session } = useSession()
  const pathname = usePathname()

  useEffect(() => {
    setPlatformAuthToken(session?.platformToken ?? initialToken)
  }, [session?.platformToken, initialToken])

  return (
    <div className="h-screen flex overflow-hidden font-hanken bg-gray-50">
      <aside
        className="w-[208px] flex flex-col flex-shrink-0"
        style={{ backgroundColor: '#F5F7FB', borderRight: '1px solid #D6DEE8' }}
      >
        <div className="h-16 flex items-center px-5 flex-shrink-0">
          <span className="text-lg font-bold text-primary">Oudmed</span>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {NAV.map((item) => {
            const active = item.href === '/platform' ? pathname === item.href : pathname?.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  active ? 'bg-white shadow-sm' : 'hover:bg-black/5'
                }`}
                style={{ color: active ? '#111827' : INACTIVE }}
              >
                <item.Icon color={active ? '#2563EB' : INACTIVE} />
                <span className={active ? 'font-semibold' : 'font-medium'}>{item.label}</span>
              </Link>
            )
          })}
        </nav>
        <div className="p-4 border-t flex items-center justify-between gap-2" style={{ borderColor: '#D6DEE8' }}>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{session?.user?.email}</p>
            <p className="text-xs text-gray-400">Platform operator</p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/platform/login' })}
            className="text-gray-400 hover:text-gray-700 flex-shrink-0"
            aria-label="Sign out"
          >
            <LogoutIcon />
          </button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
