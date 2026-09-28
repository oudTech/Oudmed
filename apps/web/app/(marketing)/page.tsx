'use client'
import { m } from 'framer-motion'
import { MarketingHeader } from '@/components/marketing/MarketingHeader'
import { PracticeExperienceWheel } from '@/components/marketing/PracticeExperienceWheel'
import { TargetOrganizations } from '@/components/marketing/TargetOrganizations'
import { PricingCalculator } from '@/components/marketing/PricingCalculator'
import { ConnectedCareSection } from '@/components/marketing/ConnectedCareSection'
import { TestimonialCarousel } from '@/components/marketing/TestimonialCarousel'
import { RealImpactSection } from '@/components/marketing/RealImpactSection'
import { CtaBanner } from '@/components/marketing/CtaBanner'
import { MarketingFooter } from '@/components/marketing/MarketingFooter'
import { Reveal } from '@/components/motion/Reveal'
import { SplitText } from '@/components/motion/SplitText'
import { AnimatedImage } from '@/components/motion/AnimatedImage'
import { Parallax } from '@/components/motion/Parallax'
import { MagneticButton } from '@/components/motion/MagneticButton'

export default function HomePage() {
  return (
    <div className="bg-white">
      <m.div
        className="relative overflow-hidden"
        style={{
          backgroundImage: 'url(/hero-bg.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'top center',
          backgroundRepeat: 'no-repeat',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
      >
        <MarketingHeader />

        <div className="max-w-4xl mx-auto px-6 pt-20 pb-16 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 leading-tight">
            <SplitText text="Manage Your Hospital Better" delayChildren={0.35} />
            <br />
            <SplitText text="With One" delayChildren={0.55} />{' '}
            <SplitText text="Powerful System" className="text-primary" delayChildren={0.65} />
          </h1>

          <Reveal delay={0.9} distance={16}>
            <p className="mt-5 text-gray-500 max-w-xl mx-auto">
              Patient records, scheduling, pharmacy, billing and claims - all in one secure platform built for
              hospitals of every size.
            </p>
          </Reveal>

          <Reveal delay={1.1} distance={12}>
            <MagneticButton>
              <a
                href="/signup"
                className="inline-block mt-8 rounded-lg bg-primary text-white px-6 py-3 text-sm font-semibold hover:brightness-95 transition"
              >
                Get Started
              </a>
            </MagneticButton>
          </Reveal>
        </div>

        <div className="max-w-4xl mx-auto px-6 pb-20">
          <Parallax strength={20}>
            <AnimatedImage delay={1.15} trigger="load">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/patient-mockup.svg"
                alt="Oudmed patient list screen"
                width={1185}
                height={612}
                className="w-full h-auto rounded-2xl shadow-2xl"
              />
            </AnimatedImage>
          </Parallax>
        </div>
      </m.div>

      <div className="max-w-6xl mx-auto px-6 pt-16 pb-10 sm:pt-24 sm:pb-14">
        <PracticeExperienceWheel />
      </div>

      <TargetOrganizations />
      <div style={{ background: '#F5F6F4' }}>
        <PricingCalculator />
      </div>
      <div className="py-16 sm:py-24">
        <ConnectedCareSection />
      </div>
      <TestimonialCarousel />
      <RealImpactSection />
      <CtaBanner />
      <MarketingFooter />
    </div>
  )
}
