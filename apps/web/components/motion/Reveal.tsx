'use client'
import { m, Variants } from 'framer-motion'
import { CSSProperties, ReactNode } from 'react'

type Direction = 'up' | 'down' | 'left' | 'right' | 'none'

interface RevealProps {
  children: ReactNode
  direction?: Direction
  distance?: number
  delay?: number
  duration?: number
  className?: string
  style?: CSSProperties
  once?: boolean
  amount?: number
  /** Starting scale (e.g. 0.92) for a scale+fade entrance. Omit for no scale effect. */
  fromScale?: number
}

const OFFSETS: Record<Direction, { x?: number; y?: number }> = {
  up: { y: 1 },
  down: { y: -1 },
  left: { x: 1 },
  right: { x: -1 },
  none: {},
}

/** Default entrance primitive: fade + directional translate, triggered once on scroll into view. */
export function Reveal({
  children,
  direction = 'up',
  distance = 28,
  delay = 0,
  duration = 0.7,
  className,
  style,
  once = true,
  amount = 0.2,
  fromScale,
}: RevealProps) {
  const offset = OFFSETS[direction]
  const variants: Variants = {
    hidden: {
      opacity: 0,
      x: offset.x ? offset.x * distance : 0,
      y: offset.y ? offset.y * distance : 0,
      scale: fromScale ?? 1,
    },
    visible: {
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      transition: { duration, delay, ease: [0.16, 1, 0.3, 1] },
    },
  }

  return (
    <m.div
      className={className}
      style={style}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, amount }}
      variants={variants}
    >
      {children}
    </m.div>
  )
}
