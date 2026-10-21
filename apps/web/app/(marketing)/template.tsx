'use client'
import { LazyMotion, domAnimation, MotionConfig } from 'framer-motion'
import { PageTransition } from '@/components/motion/PageTransition'
import { SmoothScroll } from '@/components/motion/SmoothScroll'

// Runs once per navigation (Next remounts template.tsx on every route change),
// giving marketing pages an entrance transition without touching the
// operational hospital app under (protected)/*.
//
// LazyMotion + the `m` component (used throughout components/motion and the
// marketing components, instead of the full `motion` component) trims a
// meaningful chunk of framer-motion's bundle - `domAnimation` covers every
// feature actually used here (animate/whileInView/whileHover/whileTap/exit),
// just not drag or layout animations, which nothing on this site needs.
export default function MarketingTemplate({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <div className="marketing-root">
          <SmoothScroll />
          <PageTransition>{children}</PageTransition>
        </div>
      </MotionConfig>
    </LazyMotion>
  )
}
