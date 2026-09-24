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
    // Platform-operator session (Super Admin) - mutually exclusive with the
    // hospital fields above; a browser holds one or the other, never both.
    isPlatform?: boolean
    platformToken?: string
    user: DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    type?: 'hospital' | 'platform'
    apiToken?: string
    role?: string
    emailVerified?: boolean
    tenantSlug?: string
    tenant?: TenantSummary
    platformToken?: string
    name?: string | null
    email?: string | null
    picture?: string | null
    checkedAt?: number
  }
}
