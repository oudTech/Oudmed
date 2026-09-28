'use client'
import { useEffect, useRef, useState } from 'react'
import { useInView, useMotionValue, animate } from 'framer-motion'

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia(query)
    setMatches(mql.matches)
    const listener = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener('change', listener)
    return () => mql.removeEventListener('change', listener)
  }, [query])
  return matches
}

/** True on devices with an accurate pointer (mouse/trackpad) - gates hover-only effects. */
export function usePointerFine() {
  return useMediaQuery('(pointer: fine)')
}

/** True under the `md` Tailwind breakpoint - gates desktop-only scroll choreography. */
export function useIsMobile() {
  return useMediaQuery('(max-width: 767px)')
}

/**
 * Animates a number from 0 to `target` once the element scrolls into view.
 * Returns a ref to attach to the element and the live display value.
 */
export function useCountUp(target: number, duration = 1.2) {
  const ref = useRef<HTMLElement | null>(null)
  const inView = useInView(ref, { once: true, margin: '-10% 0px' })
  const [value, setValue] = useState(0)
  const motionValue = useMotionValue(0)

  useEffect(() => {
    if (!inView) return
    const controls = animate(motionValue, target, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setValue(Math.round(v)),
    })
    return () => controls.stop()
  }, [inView, target, duration, motionValue])

  return { ref, value }
}

/** Smoothly tweens a displayed number toward `target` whenever it changes (e.g. a price responding to a slider). */
export function useAnimatedNumber(target: number, duration = 0.6) {
  const [value, setValue] = useState(target)
  const motionValue = useMotionValue(target)

  useEffect(() => {
    const controls = animate(motionValue, target, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setValue(v),
    })
    return () => controls.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration])

  return value
}
