import NextAuth from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import Credentials from 'next-auth/providers/credentials'

const API = process.env.INTERNAL_API_URL ?? 'http://localhost:3000/api'

type SessionResult = {
  accessToken: string
  user: { id: string; email: string; fullName: string; role: string; avatarUrl: string | null; emailVerified: boolean }
  tenant: { id: string; name: string; slug: string; logoUrl: string | null; primaryColor: string }
}

// 'revoked' = the API rejected the token (deactivated user/tenant, expired);
// null = transient failure (network / 5xx) - keep the existing session.
async function apiBootstrap(token: string): Promise<SessionResult | 'revoked' | null> {
  try {
    const res = await fetch(`${API}/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (res.ok) return (await res.json()) as SessionResult
    if (res.status === 401 || res.status === 403) return 'revoked'
    return null
  } catch {
    return null
  }
}

// How often the NextAuth token re-validates against the API (bounds how long a
// deactivated user keeps a working-looking UI; the API itself rejects them at once).
const RECHECK_MS = 5 * 60 * 1000

function applyResult(token: JWT, r: SessionResult): JWT {
  token.apiToken = r.accessToken
  token.role = r.user.role
  token.emailVerified = r.user.emailVerified
  token.tenantSlug = r.tenant.slug
  token.tenant = r.tenant
  token.name = r.user.fullName
  token.email = r.user.email
  token.picture = r.user.avatarUrl
  token.checkedAt = Date.now()
  return token
}

function clearSession(token: JWT): JWT {
  token.apiToken = undefined
  token.role = undefined
  token.tenant = undefined
  token.tenantSlug = undefined
  token.checkedAt = Date.now()
  return token
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true, // required: auth runs on many tenant subdomains, host is inferred per-request
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      id: 'credentials',
      // The page has already authenticated against the API and holds a session
      // token (from login / redeem-ticket / reset-password); this just validates
      // it and builds the NextAuth cookie for the current host.
      credentials: { token: {} },
      async authorize(credentials) {
        const token = credentials?.token
        if (typeof token !== 'string' || !token) return null
        const result = await apiBootstrap(token)
        if (!result || result === 'revoked') return null
        return {
          id: result.user.id,
          email: result.user.email,
          name: result.user.fullName,
          image: result.user.avatarUrl ?? undefined,
          sessionResult: result,
        } as never
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      const fresh = (user as unknown as { sessionResult?: SessionResult })?.sessionResult
      if (fresh) return applyResult(token, fresh)

      if (trigger === 'update' && session?.apiToken) {
        const result = await apiBootstrap(session.apiToken)
        if (result === 'revoked') return clearSession(token)
        if (result) applyResult(token, result)
        return token
      }

      // Periodically re-validate against the API so a deactivated user's UI
      // stops working within RECHECK_MS rather than at the 7-day token TTL.
      if (token.apiToken && Date.now() - (token.checkedAt ?? 0) > RECHECK_MS) {
        const result = await apiBootstrap(token.apiToken)
        if (result === 'revoked') return clearSession(token)
        if (result) applyResult(token, result)
        else token.checkedAt = Date.now() // transient failure: back off, keep session
      }
      return token
    },
    async session({ session, token }) {
      session.apiToken = token.apiToken
      session.role = token.role
      session.emailVerified = token.emailVerified
      session.tenantSlug = token.tenantSlug
      session.tenant = token.tenant
      session.user = {
        name: token.name ?? null,
        email: token.email ?? '',
        image: token.picture ?? null,
      } as typeof session.user
      return session
    },
  },
})
