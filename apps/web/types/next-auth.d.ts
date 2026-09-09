import type { DefaultSession } from 'next-auth'

type TenantSummary = {
  id: string
  name: string
  slug: string
  logoUrl?: string | null
  primaryColor: string
}

declare module 'next-auth' {
  interface Session {
    apiToken?: string
    role?: string
    emailVerified?: boolean
    tenantSlug?: string
    tenant?: TenantSummary
    user: DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    apiToken?: string
    role?: string
    emailVerified?: boolean
    tenantSlug?: string
    tenant?: TenantSummary
    name?: string | null
    email?: string | null
    picture?: string | null
    checkedAt?: number
  }
}
