'use client'
import Image from 'next/image'
import { Reveal } from '@/components/motion/Reveal'
import { Stagger, StaggerItem } from '@/components/motion/Stagger'
import { AnimatedImage } from '@/components/motion/AnimatedImage'

const PILLARS = [
  { label: 'Our Purpose', text: 'To simplify the business of running a hospital.' },
  { label: 'Our Mission', text: 'We deliver purpose-built solutions for the evolving needs of diverse hospitals.' },
  { label: 'Our Values', text: 'Care, Commitment, Clarity' },
]

export function WhatWeStandFor() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-16 sm:py-24 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      <AnimatedImage trigger="load" className="rounded-2xl">
        <div className="relative aspect-[4/3] w-full">
          <Image src="/real-impact1.png" alt="Oudmed team members at work" fill className="object-cover" />
        </div>
      </AnimatedImage>

      <div>
        <Reveal direction="right">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">What we stand for</h2>
          <p className="text-gray-500 mt-2">Our beliefs drive everything we do.</p>
        </Reveal>

        <Stagger className="mt-8 space-y-6">
          {PILLARS.map((p) => (
            <StaggerItem key={p.label}>
              <h3 className="text-lg font-bold text-gray-900">{p.label}</h3>
              <p className="text-gray-500 mt-1">{p.text}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  )
}
