'use client'
import { useRef } from 'react'
import { m, useMotionValue, useSpring } from 'framer-motion'
import { usePointerFine } from './hooks'

interface MagneticButtonProps {
  children: React.ReactNode
  className?: string
  /** Max pixel displacement toward the pointer. */
  strength?: number
  /** Set for a block-level child (e.g. a `w-full` submit button) instead of an inline CTA. */
  fullWidth?: boolean
}

/** Wraps a CTA so it gently pulls toward the pointer on hover, spring-back on leave. No-op on touch. */
export function MagneticButton({ children, className, strength = 14, fullWidth = false }: MagneticButtonProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isPointerFine = usePointerFine()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const springX = useSpring(x, { stiffness: 150, damping: 15, mass: 0.5 })
  const springY = useSpring(y, { stiffness: 150, damping: 15, mass: 0.5 })

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!isPointerFine || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const relX = e.clientX - (rect.left + rect.width / 2)
    const relY = e.clientY - (rect.top + rect.height / 2)
    x.set((relX / (rect.width / 2)) * strength)
    y.set((relY / (rect.height / 2)) * strength)
  }

  function handleMouseLeave() {
    x.set(0)
    y.set(0)
  }

  return (
    <m.div
      ref={ref}
      className={className}
      style={{ x: springX, y: springY, display: fullWidth ? 'block' : 'inline-block', width: fullWidth ? '100%' : undefined }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </m.div>
  )
}
