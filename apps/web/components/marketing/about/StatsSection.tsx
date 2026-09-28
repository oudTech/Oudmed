'use client'
import Image from 'next/image'
import { Reveal } from '@/components/motion/Reveal'
import { Stagger, StaggerItem } from '@/components/motion/Stagger'
import { AnimatedImage } from '@/components/motion/AnimatedImage'
import { useCountUp } from '@/components/motion/hooks'

// Placeholder figures, not real traction numbers - the Figma design's own
// stats (31M+ patient records, 3,000+ employees, "Enterprise and Office")
// are NextGen Healthcare's real, actual company figures, not Oudmed's. Swap
// these for Oudmed's real numbers once they exist.
const STATS = [
  { value: '50+', label: 'Hospitals supported with Oudmed' },
  { value: '10+', label: 'Locations nationwide' },
  { value: '100K+', label: 'Patient records managed' },
  { value: '8+', label: 'Clinical specialties supported' },
  { value: '20+', label: 'Facilities served' },
  { value: '24/7', label: 'Platform monitoring and support' },
]

function parseStat(value: string) {
  const match = value.match(/^(\d+)(.*)$/)
  if (!match) return null
  return { target: Number(match[1]), suffix: match[2] }
}

function StatValue({ value }: { value: string }) {
  const parsed = parseStat(value)
  const { ref, value: count } = useCountUp(parsed?.target ?? 0)
  if (!parsed) return <p className="text-3xl sm:text-4xl font-bold text-gray-900 tabular-nums">{value}</p>
  return (
    <p ref={ref as React.RefObject<HTMLParagraphElement>} className="text-3xl sm:text-4xl font-bold text-gray-900 tabular-nums">
      {count}
      {parsed.suffix}
    </p>
  )
}

export function StatsSection() {
  return (
    <section style={{ background: '#F5F6F4' }}>
      <div className="max-w-6xl mx-auto px-6 py-16 sm:py-24 grid grid-cols-1 lg:grid-cols-[1fr,1.4fr] gap-12">
        <div>
          <Reveal direction="left">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900">Here for what&apos;s next</h2>
            <p className="text-gray-500 mt-4">
              We believe in proof, not promises. That&apos;s why we&apos;ve significantly invested in creating a
              healthcare IT experience that&apos;s smooth from start to finish. Here&apos;s what that looks like in
              practice.
            </p>
          </Reveal>

          <AnimatedImage trigger="load" className="rounded-2xl mt-8">
            <div className="relative aspect-[4/3] w-full">
              <Image src="/real-impact2.png" alt="Oudmed team members at work" fill className="object-cover" />
            </div>
          </AnimatedImage>
        </div>

        <Stagger className="grid grid-cols-1 sm:grid-cols-2 gap-4" stagger={0.07}>
          {STATS.map((s) => (
            <StaggerItem key={s.label}>
              <div className="bg-white rounded-xl border border-gray-100 p-6">
                <StatValue value={s.value} />
                <p className="text-gray-500 mt-2 text-sm">{s.label}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  )
}
