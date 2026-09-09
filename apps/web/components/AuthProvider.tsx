'use client'
import type { Session } from 'next-auth'

/** Applies the tenant's brand colour as a CSS variable for the app shell. */
export default function AuthProvider({
  session,
  children,
}: {
  session: Session
  children: React.ReactNode
}) {
  const primaryColor = session.tenant?.primaryColor ?? '#3366E3'
  return (
    <div style={{ '--brand-primary': primaryColor } as React.CSSProperties}>{children}</div>
  )
}
