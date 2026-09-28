'use client'
import { Reveal } from '@/components/motion/Reveal'

export function AboutBanner() {
  return (
    <section className="max-w-6xl mx-auto px-6">
      <Reveal fromScale={0.96}>
        <div
          className="rounded-3xl px-8 py-10 sm:px-12 sm:py-14 text-white"
          style={{ background: 'linear-gradient(90deg, #0A172D 0%, #2563EB 100%)' }}
        >
          <p className="text-xl sm:text-2xl font-semibold leading-snug">
            Oudmed Healthcare puts you confidently in control of your hospital, delivering the solutions you need to
            simplify your operations.
          </p>
          <p className="text-white/80 mt-5">
            Healthcare management can become complicated as your hospital grows. Oudmed helps simplify the everyday
            work by bringing your patients, staff, records, billing, and operations into one organized platform. Built
            for the way modern hospitals operate, Oudmed adapts to your needs and gives your team the tools to work
            more efficiently, stay organized, and focus on what matters most: providing better care for your patients.
          </p>
          <p className="mt-5 font-semibold">
            This is simpler healthcare management.
            <br />
            This is Oudmed.
          </p>
        </div>
      </Reveal>
    </section>
  )
}
