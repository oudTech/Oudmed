import { MarketingHeader } from '@/components/marketing/MarketingHeader'
import { MarketingFooter } from '@/components/marketing/MarketingFooter'
import { TestimonialCarousel } from '@/components/marketing/TestimonialCarousel'
import { AboutHero } from '@/components/marketing/about/AboutHero'
import { AboutBanner } from '@/components/marketing/about/AboutBanner'
import { WhatWeStandFor } from '@/components/marketing/about/WhatWeStandFor'
import { StatsSection } from '@/components/marketing/about/StatsSection'
import { LeadershipSection } from '@/components/marketing/about/LeadershipSection'
import { CareersSection } from '@/components/marketing/about/CareersSection'

export default function AboutPage() {
  return (
    <div className="bg-white">
      <div style={{ background: '#F5F6F4' }}>
        <MarketingHeader />
        <AboutHero />
      </div>

      <div className="py-16 sm:py-24">
        <AboutBanner />
      </div>

      <WhatWeStandFor />
      <StatsSection />
      <TestimonialCarousel />
      <LeadershipSection />
      <CareersSection />
      <MarketingFooter />
    </div>
  )
}
