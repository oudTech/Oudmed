/** @type {import('next').NextConfig} */

// SEC-1/SEC-2 mitigation (pre-launch audit, 2026-09-30): the Next.js Image
// Optimization API has a critical unauthenticated RCE via AVIF files, fixed
// only in Next 15.5.24+ (we're on 14.2.35 pending that upgrade - tracked as
// the first Phase 2 item). Every real <Image> usage of remote/uploaded
// content (patient photos, hospital/tenant logos) already passes
// `unoptimized` explicitly, so this was already not exercised - `unoptimized:
// true` here makes that the enforced default instead of a per-usage
// convention, closing the path even if a future change forgets the prop.
// Do NOT remove this or reintroduce `images.remotePatterns` until the app is
// upgraded to Next >=15.5.24 and the advisory is confirmed patched.
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@oudhealth/contracts', '@oudhealth/validation'],
  images: { unoptimized: true },
}

module.exports = nextConfig
