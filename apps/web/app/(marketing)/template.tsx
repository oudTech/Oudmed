'use client'
import dynamic from 'next/dynamic'
import { LazyMotion, domAnimation, MotionConfig } from 'framer-motion'
import { CursorProvider } from '@/components/motion/CursorProvider'
import { PageTransition } from '@/components/motion/PageTransition'

// Touches window/matchMedia directly - keep it out of the server render entirely.
const CustomCursor = dynamic(() => import('@/components/motion/CustomCursor').then((mod) => mod.CustomCursor), {
  ssr: false,
})

// Runs once per navigation (Next remounts template.tsx on every route change),
// giving marketing pages an entrance transition + a custom cursor without
// touching the operational hospital app under (protected)/*.
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
        <CursorProvider>
          <div className="marketing-root">
            <CustomCursor />
            <PageTransition>{children}</PageTransition>
          </div>
        </CursorProvider>
      </MotionConfig>
    </LazyMotion>
  )
}
