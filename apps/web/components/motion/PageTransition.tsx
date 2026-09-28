'use client'
import { m } from 'framer-motion'
import { ReactNode } from 'react'

/**
 * Entrance-only route transition. Next's App Router `template.tsx` remounts
 * on every navigation, which gives us this fade+rise for free without the
 * unmount/exit choreography that would need the experimental View
 * Transitions API to do safely.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <m.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </m.div>
  )
}
