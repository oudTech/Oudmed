'use client'
import { useEffect } from 'react'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'

/**
 * Inertia-smoothed wheel scrolling for the marketing pages (the same technique
 * most animation-heavy sites use). Lenis still drives the real window scroll,
 * so framer-motion's useScroll and GSAP ScrollTrigger keep working unchanged.
 *
 * Touch devices keep native scrolling (Lenis leaves touch alone by default),
 * and nothing is smoothed for users with prefers-reduced-motion.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const lenis = new Lenis({ lerp: 0.1, autoRaf: true, anchors: true })
    return () => lenis.destroy()
  }, [])

  return null
}
