'use client'
import { useRef } from 'react'
import { m, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { usePointerFine } from './hooks'

interface TiltCardProps {
  children: React.ReactNode
  className?: string
  /** Max tilt in degrees. */
  maxTilt?: number
  /** Scale applied on hover. */
  hoverScale?: number
}

/** Pointer-driven 3D tilt + subtle lift on hover. No-op passthrough on touch. */
export function TiltCard({ children, className, maxTilt = 6, hoverScale = 1.02 }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isPointerFine = usePointerFine()
  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  const springPx = useSpring(px, { stiffness: 200, damping: 20 })
  const springPy = useSpring(py, { stiffness: 200, damping: 20 })

  const rotateX = useTransform(springPy, [0, 1], [maxTilt, -maxTilt])
  const rotateY = useTransform(springPx, [0, 1], [-maxTilt, maxTilt])

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!isPointerFine || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    px.set((e.clientX - rect.left) / rect.width)
    py.set((e.clientY - rect.top) / rect.height)
  }

  function handleMouseLeave() {
    px.set(0.5)
    py.set(0.5)
  }

  return (
    <m.div
      ref={ref}
      className={className}
      style={{ rotateX, rotateY, transformPerspective: 800 }}
      whileHover={isPointerFine ? { scale: hoverScale } : undefined}
      transition={{ type: 'spring', stiffness: 250, damping: 20 }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </m.div>
  )
}
