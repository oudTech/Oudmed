'use client'
import { createPortal } from 'react-dom'

export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

/**
 * Dims the whole viewport except a padded hole around `rect`. Built as four
 * `<div>`s framing the hole (no SVG mask pointer-events quirks). The hole is a
 * real gap, so when `interactive` the highlighted element stays clickable; when
 * it is not, a transparent cover over the target blocks stray clicks. The frame
 * animates between targets unless the user prefers reduced motion.
 */
export function Spotlight({
  rect,
  padding = 6,
  interactive = false,
  reducedMotion = false,
  onOverlayClick,
}: {
  rect: Rect | null
  padding?: number
  interactive?: boolean
  reducedMotion?: boolean
  onOverlayClick?: () => void
}) {
  if (typeof document === 'undefined' || !rect) return null

  const t = Math.max(0, rect.top - padding)
  const l = Math.max(0, rect.left - padding)
  const w = rect.width + padding * 2
  const h = rect.height + padding * 2
  const dim = 'rgba(15, 23, 42, 0.55)'
  const anim = reducedMotion ? '' : 'transition-all duration-300 ease-out'

  const panel = (style: React.CSSProperties): React.CSSProperties => ({
    position: 'fixed',
    background: dim,
    ...style,
  })

  return createPortal(
    <div aria-hidden className="pointer-events-none" style={{ position: 'fixed', inset: 0, zIndex: 1200 }}>
      {/* four dimming panels around the hole */}
      <div
        className={`${anim} pointer-events-auto`}
        style={panel({ top: 0, left: 0, right: 0, height: t })}
        onClick={onOverlayClick}
      />
      <div
        className={`${anim} pointer-events-auto`}
        style={panel({ top: t + h, left: 0, right: 0, bottom: 0 })}
        onClick={onOverlayClick}
      />
      <div
        className={`${anim} pointer-events-auto`}
        style={panel({ top: t, left: 0, width: l, height: h })}
        onClick={onOverlayClick}
      />
      <div
        className={`${anim} pointer-events-auto`}
        style={panel({ top: t, left: l + w, right: 0, height: h })}
        onClick={onOverlayClick}
      />

      {/* highlight ring */}
      <div
        className={anim}
        style={{
          position: 'fixed',
          top: t,
          left: l,
          width: w,
          height: h,
          borderRadius: 10,
          boxShadow:
            '0 0 0 2px var(--brand-primary, #3366E3), 0 0 0 6px rgba(51,102,227,0.25)',
          pointerEvents: 'none',
        }}
      />

      {/* click shield over the target when the step is not interactive */}
      {!interactive && (
        <div
          className="pointer-events-auto"
          style={{ position: 'fixed', top: t, left: l, width: w, height: h }}
          onClick={onOverlayClick}
        />
      )}
    </div>,
    document.body,
  )
}
