import type { MetadataRoute } from 'next'
import { ROOT_DOMAIN, APP_PROTOCOL } from '@/lib/tenant'

// Deliberately tiny: this app has exactly two indexable pages (see robots.ts
// for why). Everything else is a hospital's private records behind a login.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = `${APP_PROTOCOL}://${ROOT_DOMAIN}`
  return [
    { url: `${base}/`, lastModified: new Date() },
    { url: `${base}/signup`, lastModified: new Date() },
  ]
}
