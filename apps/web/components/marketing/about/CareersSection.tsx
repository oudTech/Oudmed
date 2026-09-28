'use client'
import Image from 'next/image'
import { Reveal } from '@/components/motion/Reveal'
import { AnimatedImage } from '@/components/motion/AnimatedImage'

export function CareersSection() {
  return (
    <section id="careers" className="max-w-6xl mx-auto px-6 py-16 sm:py-24 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      {/* real-impact3.png was pulled (a real, unrelated healthcare company's
          logo was visible on the lab coat) and no 4th clean photo exists yet -
          reusing real-impact1.png rather than leaving this gray. It's already
          used on WhatWeStandFor further up this page; swap in a dedicated
          photo here once one is available. */}
      <AnimatedImage trigger="load" className="rounded-2xl">
        <div className="relative aspect-[4/3] w-full">
          <Image src="/real-impact1.png" alt="Oudmed team members at work" fill className="object-cover" />
        </div>
      </AnimatedImage>

      <Reveal direction="right">
        <p className="text-sm font-semibold" style={{ color: '#3A6F8F' }}>Careers</p>
        <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mt-2">Join the next generation</h2>
        {/* "Over 3,000 problem-solvers" in the Figma design is NextGen Healthcare's
            real headcount, not Oudmed's - using a placeholder figure instead, per
            the same decision as the stats section above. */}
        <p className="text-gray-500 mt-4">
          Healthcare is complex. That&apos;s exactly why we hire people who want to solve it. Over 50 problem-solvers,
          builders and thinkers work together here to make hospital care simpler for everyone.
        </p>
      </Reveal>
    </section>
  )
}
