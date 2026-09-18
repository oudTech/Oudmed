import type { MetadataRoute } from 'next'
import { ROOT_DOMAIN, APP_PROTOCOL } from '@/lib/tenant'

// This same file is what search engines see at <every-hostname>/robots.txt -
// the apex (oudmed.com) and every hospital's own subdomain alike, since Next
// does not vary static routes by Host header. That is exactly the policy we
// want: a tiny public allowlist (sign-up flow), everything else disallowed -
// dashboards, patient records, billing, staff data, and the per-tenant login
// page (which has no unique content to index once per hospital anyway).
//
// This complements, it does not replace, the noindex on each of those pages -
// middleware also keeps a crawler with no session out of (protected) entirely.
export default function robots(): MetadataRoute.Robots {
  const base = `${APP_PROTOCOL}://${ROOT_DOMAIN}`
  return {
    rules: {
      userAgent: '*',
      allow: ['/$', '/signup'],
      disallow: '/',
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
