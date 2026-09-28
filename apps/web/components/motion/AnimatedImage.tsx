'use client'
import { m, Variants } from 'framer-motion'
import { ReactNode } from 'react'

interface AnimatedImageProps {
  children: ReactNode
  className?: string
  delay?: number
  amount?: number
  /**
   * 'view' (default) reveals on scroll into view via `whileInView`; 'load'
   * reveals immediately on mount via `animate`. NOTE: every real usage in
   * this codebase currently passes 'load' - 'view' was found to leave the
   * image permanently clipped (invisible) in production use on nested
   * clip-path animations under this LazyMotion setup, for reasons not fully
   * root-caused. Don't reach for the 'view' default without verifying it
   * actually reveals - `Reveal`/`Stagger` (plain opacity/transform, no
   * clip-path) don't show the same issue.
   */
  trigger?: 'view' | 'load'
}

/**
 * Clip-path reveal + scale-settle for hero/section imagery. The clip-path
 * animates on the outer (fixed-size) wrapper and the scale-settle animates on
 * an inner element instead - scaling the outer box itself would overflow past
 * its own parent, since `overflow: hidden` only clips a box's children, not
 * the box's own transformed bounds.
 */
export function AnimatedImage({ children, className, delay = 0, amount = 0.1, trigger = 'view' }: AnimatedImageProps) {
  const wrapperVariants: Variants = {
    hidden: { clipPath: 'inset(100% 0% 0% 0%)' },
    visible: {
      clipPath: 'inset(0% 0% 0% 0%)',
      transition: { duration: 1, ease: [0.16, 1, 0.3, 1], delay },
    },
  }
  const innerVariants: Variants = {
    hidden: { scale: 1.08 },
    visible: { scale: 1, transition: { duration: 1, ease: [0.16, 1, 0.3, 1], delay } },
  }

  const triggerProps =
    trigger === 'load' ? { animate: 'visible' } : { whileInView: 'visible', viewport: { once: true, amount } }

  return (
    <m.div
      className={className}
      initial="hidden"
      {...triggerProps}
      variants={wrapperVariants}
      style={{ overflow: 'hidden' }}
    >
      <m.div variants={innerVariants}>{children}</m.div>
    </m.div>
  )
}
