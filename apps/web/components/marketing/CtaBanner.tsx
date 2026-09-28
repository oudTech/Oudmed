'use client'
import { Reveal } from '@/components/motion/Reveal'
import { MagneticButton } from '@/components/motion/MagneticButton'

export function CtaBanner() {
  return (
    <section className="max-w-6xl mx-auto px-6 pb-16 sm:pb-24">
      <Reveal fromScale={0.95}>
        <div
          className="rounded-3xl px-6 py-14 sm:py-20 text-center"
          style={{ background: 'linear-gradient(90deg, #05070F 0%, #1E3A8A 60%, #2563EB 100%)' }}
        >
          <p className="text-white/70 text-sm">Ready to level up your practice?</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mt-2">Make the switch to Oudmed Healthcare</h2>
          <MagneticButton className="mt-8">
            <a
              href="/signup"
              className="inline-block rounded-full bg-primary text-white px-6 py-3 text-sm font-semibold hover:brightness-95 transition"
            >
              Schedule Custom Demo
            </a>
          </MagneticButton>
        </div>
      </Reveal>
    </section>
  )
}
