'use client'
import Image from 'next/image'
import { Reveal } from '@/components/motion/Reveal'
import { SplitText } from '@/components/motion/SplitText'
import { AnimatedImage } from '@/components/motion/AnimatedImage'
import { Parallax } from '@/components/motion/Parallax'
import { MagneticButton } from '@/components/motion/MagneticButton'

export function AboutHero() {
  return (
    <section className="max-w-6xl mx-auto px-6 pt-16 pb-16 sm:pt-24 sm:pb-24 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      <div>
        <Reveal delay={0.1} distance={14}>
          <p className="text-sm font-semibold" style={{ color: '#3A6F8F' }}>About Us</p>
        </Reveal>
        <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mt-3 leading-tight">
          <SplitText text="We're on a journey to digitize healthcare across Africa" delayChildren={0.2} />
        </h1>
        <Reveal delay={0.7} distance={16}>
          <p className="text-gray-500 mt-5 max-w-md">
            Healthcare management shouldn&apos;t be complicated. Oudmed gives hospitals a simple, reliable way to
            manage their operations, stay organized, and grow without losing momentum.
          </p>
        </Reveal>
        <Reveal delay={0.85} distance={12}>
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

      <Parallax strength={18} className="relative">
        {/* Offset background panel, matching the design's layered-photo look. */}
        <div
          className="absolute -right-4 -top-4 -bottom-4 left-10 rounded-3xl"
          style={{ background: 'linear-gradient(160deg, #0A172D 0%, #2563EB 100%)' }}
        />
        <AnimatedImage
          delay={0.5}
          trigger="load"
          className="relative -ml-6 sm:-ml-10 rounded-2xl shadow-xl"
        >
          <div className="relative aspect-[4/3] w-full">
            <Image
              src="/about-hero.png"
              alt="The Oudmed team collaborating around a whiteboard"
              fill
              className="object-cover"
            />
          </div>
        </AnimatedImage>
      </Parallax>
    </section>
  )
}
