/** @type {import('next').NextConfig} */

// Origins the Next image pipeline is allowed to load from. Presigned object-storage
// URLs point here (MinIO in dev; S3 / R2 / Spaces in prod). Comma-separated,
// e.g. "https://files.oudmed.com,https://oudmed.s3.eu-west-1.amazonaws.com".
const storageOrigins = (process.env.NEXT_PUBLIC_STORAGE_ORIGIN || 'http://localhost:9000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const remotePatterns = storageOrigins.map((origin) => {
  const u = new URL(origin)
  if (!u.hostname || u.hostname.includes('*')) {
    throw new Error(`NEXT_PUBLIC_STORAGE_ORIGIN must be concrete origins, got "${origin}"`)
  }
  return {
    protocol: u.protocol.replace(':', ''),
    hostname: u.hostname,
    ...(u.port ? { port: u.port } : {}),
  }
})

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@oudhealth/contracts', '@oudhealth/validation'],
  images: { remotePatterns },
}

module.exports = nextConfig
