import { ImageResponse } from 'next/og'
import { BRAND_GRADIENT, O_RING_PATH } from '@/lib/brand-marks'

// See app/opengraph-image.tsx - the edge runtime avoids a Windows-only bug
// in the Node.js runtime's loading of next/og's bundled font/wasm assets.
export const runtime = 'edge'
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: BRAND_GRADIENT,
        }}
      >
        <svg width={112} height={112} viewBox="0 0 25 25">
          <path d={O_RING_PATH} fill="#FFFFFF" />
        </svg>
      </div>
    ),
    { ...size },
  )
}
