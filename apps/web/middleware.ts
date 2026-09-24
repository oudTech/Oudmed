import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { subdomainFromHost } from '@/lib/tenant'

const HOME = '/dashboard'

/** Apex domain: only new-clinic sign-up + marketing + the Super Admin dashboard live here. */
const APEX_ALLOWED = ['/', '/signup', '/verify-email', '/onboarding', '/legal', '/platform']

/** Tenant subdomain: reachable without a session. */
const TENANT_PUBLIC = ['/login', '/forgot-password', '/reset-password', '/auth/callback', '/legal']

const startsWithAny = (path: string, list: string[]) =>
  list.some((p) => path === p || path.startsWith(p + '/'))

// Crawler-facing files Next generates from app/robots.ts and app/sitemap.ts.
// These must be reachable on every hostname (apex and every tenant subdomain
// alike - see app/robots.ts) without going through the auth/tenant gate below,
// the same way _next/static and favicon.ico are already excluded by the
// matcher itself.
const CRAWLER_FILES = ['/robots.txt', '/sitemap.xml']

export default auth((req) => {
  const { pathname } = req.nextUrl
  if (CRAWLER_FILES.includes(pathname)) return NextResponse.next()

  const host = req.headers.get('host')
  const sub = subdomainFromHost(host)

  const redirect = (path: string) => {
    if (pathname === path) return NextResponse.next()
    const url = req.nextUrl.clone()
    url.pathname = path
    url.search = ''
    return NextResponse.redirect(url)
  }

  // ── Apex domain ──
  if (!sub) {
    if (startsWithAny(pathname, APEX_ALLOWED)) return NextResponse.next()
    return redirect('/')
  }

  // ── Tenant subdomain ──
  const session = req.auth
  const isPublic = startsWithAny(pathname, TENANT_PUBLIC)

  // No session, or the API revoked it (deactivated user/tenant → token cleared).
  if (!session || !session.apiToken) {
    return isPublic ? NextResponse.next() : redirect('/login')
  }

  // Signed in, but the cookie belongs to a different tenant (stale / tampered).
  if (session.tenantSlug && session.tenantSlug !== sub) {
    return redirect('/login')
  }

  // Signed in on an auth page → into the app.
  if (pathname === '/' || isPublic) return redirect(HOME)

  return NextResponse.next()
})

export const config = {
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)',
  ],
}
