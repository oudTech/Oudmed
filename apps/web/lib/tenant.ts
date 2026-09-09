/**
 * Domain model:
 *   apex   (marketing + new-clinic sign-up):  <root>            e.g. localhost:3001 / oudmed.com
 *   tenant (a clinic's workspace):            <slug>.<root>     e.g. demo.localhost:3001
 */
export const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost'
export const APP_PROTOCOL = process.env.NEXT_PUBLIC_APP_PROTOCOL ?? 'http'

/** Strip a `:port` suffix. */
function bareHost(host: string): string {
  return host.replace(/:\d+$/, '')
}

/** null on the apex domain; the slug on a tenant subdomain. */
export function subdomainFromHost(host: string | null | undefined): string | null {
  if (!host) return null
  const h = bareHost(host)
  const root = bareHost(ROOT_DOMAIN)
  if (h === root || h === `www.${root}`) return null
  if (h.endsWith(`.${root}`)) {
    const sub = h.slice(0, -(root.length + 1))
    return sub && !sub.includes('.') ? sub : sub.split('.')[0] || null
  }
  return null
}

/** Client-side: the current tenant slug, or null on the apex. */
export function currentSubdomain(): string | null {
  if (typeof window === 'undefined') return null
  return subdomainFromHost(window.location.host)
}

export function apexUrl(path = ''): string {
  const port = typeof window !== 'undefined' ? window.location.port : ''
  const host = port ? `${bareHost(ROOT_DOMAIN)}:${port}` : ROOT_DOMAIN
  return `${APP_PROTOCOL}://${host}${path}`
}

export function tenantUrl(slug: string, path = ''): string {
  const port = typeof window !== 'undefined' ? window.location.port : ''
  const root = port ? `${bareHost(ROOT_DOMAIN)}:${port}` : ROOT_DOMAIN
  return `${APP_PROTOCOL}://${slug}.${root}${path}`
}
