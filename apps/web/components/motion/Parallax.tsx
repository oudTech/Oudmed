'use client'
import { useRef } from 'react'
import { m, useScroll, useTransform, useReducedMotion } from 'framer-motion'
import { useIsMobile } from './hooks'

interface ParallaxProps {
  children: React.ReactNode
  className?: string
  /** Pixels of vertical travel across the element's scroll range. Positive moves down slower, negative faster. */
  strength?: number
  /** Optional scale range instead of / in addition to vertical travel. */
  scaleRange?: [number, number]
}

/** Scroll-linked parallax translate/scale, dampened on mobile and disabled under reduced motion. */
export function Parallax({ children, className, strength = 40, scaleRange }: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()
  const prefersReduced = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })

  const effectiveStrength = prefersReduced ? 0 : isMobile ? strength * 0.35 : strength
  const y = useTransform(scrollYProgress, [0, 1], [effectiveStrength, -effectiveStrength])
  const scale = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    scaleRange && !prefersReduced ? [scaleRange[0], (scaleRange[0] + scaleRange[1]) / 2, scaleRange[1]] : [1, 1, 1],
  )

  return (
    <m.div ref={ref} className={className} style={{ y, scale }}>
      {children}
    </m.div>
  )
}
