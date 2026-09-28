'use client'
import Image from 'next/image'
import { Reveal } from '@/components/motion/Reveal'
import { AnimatedImage } from '@/components/motion/AnimatedImage'

export function LeadershipSection() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-16 sm:py-24 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      <Reveal direction="left">
        <p className="text-sm font-semibold" style={{ color: '#3A6F8F' }}>Leadership</p>
        <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mt-2">Meet the Leaders Shaping the Future of Oudmed</h2>
        <p className="text-gray-500 mt-4">
          At Oudmed Healthcare, our leadership team brings together deep expertise in healthcare, technology, and
          innovation. United by a shared mission to improve the provider and patient experience, they guide our
          organization with integrity, purpose, and a relentless focus on delivering better outcomes for hospitals.
        </p>
      </Reveal>

      <AnimatedImage trigger="load" className="rounded-2xl">
        <div className="relative aspect-[4/3] w-full">
          <Image src="/real-impact2.png" alt="Oudmed leadership team" fill className="object-cover" />
        </div>
      </AnimatedImage>
    </section>
  )
}
