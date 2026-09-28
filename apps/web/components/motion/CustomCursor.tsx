'use client'
import { useEffect, useState } from 'react'
import { m, useMotionValue, useSpring, AnimatePresence } from 'framer-motion'
import { usePointerFine } from './hooks'
import { useCursor } from './CursorProvider'

/**
 * Fixed dot+ring that smoothly follows the pointer, grows over interactive
 * elements, and can show short contextual text via `useCursor()`.
 * `pointer-events-none` throughout so it can never block a click, drag, or
 * text selection. Renders nothing on touch devices.
 */
export function CustomCursor() {
  const isPointerFine = usePointerFine()
  const { text } = useCursor()
  const [hovering, setHovering] = useState(false)
  const [visible, setVisible] = useState(false)

  const x = useMotionValue(-100)
  const y = useMotionValue(-100)
  const springX = useSpring(x, { stiffness: 400, damping: 40, mass: 0.4 })
  const springY = useSpring(y, { stiffness: 400, damping: 40, mass: 0.4 })

  useEffect(() => {
    if (!isPointerFine) return

    // mousemove can fire far more often than the screen repaints - position
    // updates are cheap motion-value writes (fine per-event), but the
    // closest() DOM walk + state update are throttled to once per animation
    // frame so cursor tracking never adds more main-thread work than the
    // browser can actually paint.
    let rafId: number | null = null
    let pendingTarget: HTMLElement | null = null

    function handleMove(e: MouseEvent) {
      x.set(e.clientX)
      y.set(e.clientY)
      if (!visible) setVisible(true)
      pendingTarget = e.target as HTMLElement
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          setHovering(!!pendingTarget?.closest('a, button, [role="button"], input[type="range"]'))
          rafId = null
        })
      }
    }
    function handleLeaveWindow() {
      setVisible(false)
    }

    window.addEventListener('mousemove', handleMove)
    document.documentElement.addEventListener('mouseleave', handleLeaveWindow)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      document.documentElement.removeEventListener('mouseleave', handleLeaveWindow)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [isPointerFine, visible, x, y])

  if (!isPointerFine) return null

  const scale = text ? 2.6 : hovering ? 1.8 : 1

  return (
    <m.div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        x: springX,
        y: springY,
        translateX: '-50%',
        translateY: '-50%',
        zIndex: 9999,
        pointerEvents: 'none',
        opacity: visible ? 1 : 0,
      }}
      transition={{ opacity: { duration: 0.2 } }}
    >
      <m.div
        animate={{ scale }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        style={{
          width: 16,
          height: 16,
          borderRadius: '9999px',
          background: text ? '#0B1632' : 'white',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AnimatePresence>
          {text && (
            <m.span
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              style={{
                position: 'absolute',
                fontSize: 11,
                fontWeight: 600,
                color: 'white',
                whiteSpace: 'nowrap',
              }}
            >
              {text}
            </m.span>
          )}
        </AnimatePresence>
      </m.div>
    </m.div>
  )
}
