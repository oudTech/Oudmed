import { ImageResponse } from 'next/og'
import { BRAND_GRADIENT, O_RING_PATH, WORDMARK_LETTER_PATHS } from '@/lib/brand-marks'

// Forces the edge runtime's module loader (webpack-bundled), not the
// Node.js runtime's raw dynamic import of next/dist/compiled/@vercel/og -
// the latter mis-resolves its own bundled font/wasm asset paths on Windows.
export const runtime = 'edge'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: 'flex',
          position: 'relative',
          background: BRAND_GRADIENT,
          overflow: 'hidden',
        }}
      >
        {/* oversized watermark O-ring, cropped into the bottom-right corner */}
        <div style={{ position: 'absolute', right: -170, bottom: -190, opacity: 0.07, display: 'flex' }}>
          <svg width={760} height={760} viewBox="0 0 25 25">
            <path d={O_RING_PATH} fill="#FFFFFF" />
          </svg>
        </div>

        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: '100%',
            height: '100%',
            padding: '92px 100px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: 6,
                color: 'rgba(255,255,255,0.72)',
                marginBottom: 30,
                display: 'flex',
              }}
            >
              HOSPITAL MANAGEMENT SYSTEM
            </div>
            <div style={{ display: 'flex', marginBottom: 32 }}>
              <svg width={460} height={460 * (25 / 121)} viewBox="0 0 121 25">
                {WORDMARK_LETTER_PATHS.map((d, i) => (
                  <path key={i} d={d} fill="#FFFFFF" />
                ))}
                <path d={O_RING_PATH} fill="#FFFFFF" />
              </svg>
            </div>
            <div
              style={{
                fontSize: 32,
                lineHeight: 1.45,
                color: 'rgba(255,255,255,0.92)',
                maxWidth: 820,
                fontWeight: 400,
                display: 'flex',
              }}
            >
              Patient records, scheduling, pharmacy, billing and HMO claims, one connected system for African
              hospitals.
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 22px',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.12)',
                border: '1px solid rgba(255,255,255,0.28)',
              }}
            >
              <div style={{ width: 9, height: 9, borderRadius: 999, background: '#FFFFFF', display: 'flex' }} />
              <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: 1, color: '#FFFFFF', display: 'flex' }}>
                oudmed.com
              </div>
            </div>
            <div style={{ fontSize: 19, letterSpacing: 3, color: 'rgba(255,255,255,0.55)', fontWeight: 600, display: 'flex' }}>
              MULTI-TENANT PLATFORM
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}
