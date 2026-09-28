'use client'
import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

interface PinnedScrollSectionProps {
  children: React.ReactNode
  className?: string
  /** Number of discrete steps to scrub through (e.g. tab count). */
  steps: number
  /** Called with the active step index as the user scrolls. */
  onStepChange: (index: number) => void
  /** Extra scroll distance per step, in viewport-height units. */
  stepHeight?: number
}

/**
 * The one deliberate pinned/scrubbed section in the site. Pins `children` in
 * place for `steps * stepHeight` viewport-heights of scroll and reports the
 * active step. Only active at `md` and up, and never when the user has
 * `prefers-reduced-motion: reduce` set - both cases fall back to whatever
 * static/click-driven UI the caller already renders.
 */
export function PinnedScrollSection({
  children,
  className,
  steps,
  onStepChange,
  stepHeight = 0.6,
}: PinnedScrollSectionProps) {
  const ref = useRef<HTMLDivElement>(null)
  const onStepChangeRef = useRef(onStepChange)
  onStepChangeRef.current = onStepChange
  const lastIndexRef = useRef(-1)

  useEffect(() => {
    if (!ref.current) return
    gsap.registerPlugin(ScrollTrigger)

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return

    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia()
      mm.add('(min-width: 768px)', () => {
        const trigger = ScrollTrigger.create({
          trigger: ref.current,
          start: 'top top',
          end: `+=${window.innerHeight * stepHeight * (steps - 1)}`,
          pin: true,
          scrub: 0.4,
          onUpdate: (self) => {
            const index = Math.min(steps - 1, Math.floor(self.progress * steps))
            if (index !== lastIndexRef.current) {
              lastIndexRef.current = index
              onStepChangeRef.current(index)
            }
          },
        })
        return () => trigger.kill()
      })
      return () => mm.revert()
    }, ref)

    return () => ctx.revert()
  }, [steps, stepHeight])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
