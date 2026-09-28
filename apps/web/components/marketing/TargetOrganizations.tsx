'use client'
import { Reveal } from '@/components/motion/Reveal'
import { Stagger, StaggerItem } from '@/components/motion/Stagger'
import { TiltCard } from '@/components/motion/TiltCard'

const ORG_TYPES = [
  'Private Clinics',
  'Small Private Hospitals',
  'Primary Healthcare Centres',
  'Community Health Centres',
  'Maternity Homes',
  'Family Medicine Clinics',
  'Pediatric Clinics',
  'General Practice (GP) Clinics',
  'Dental Clinics',
  'Eye Clinics',
  'Physiotherapy & Rehabilitation',
  'Diagnostic Centres',
  'Medical Laboratories',
  'NGO Health Clinics',
]

export function TargetOrganizations() {
  return (
    <section className="max-w-6xl mx-auto px-6 pt-10 pb-16 sm:pt-14 sm:pb-24 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      <Reveal direction="left">
        <p className="text-sm font-semibold" style={{ color: '#3A6F8F' }}>Target Organisation</p>
        <h2 className="text-3xl sm:text-4xl font-medium mt-2" style={{ color: '#0B1632' }}>Perfect For Small Hospitals</h2>
        <p className="text-gray-500 mt-4 leading-relaxed">
          Our Hospital Management System is built for small and growing healthcare facilities that want to simplify
          their daily operations, improve patient care, and eliminate paperwork. Whether you run a private clinic,
          maternity home, diagnostic centre, or community health facility, our platform provides the tools you need
          to manage your hospital efficiently from one secure system.
        </p>
      </Reveal>

      <Stagger className="grid grid-cols-2 gap-3" stagger={0.04}>
        {ORG_TYPES.map((org) => (
          <StaggerItem key={org} distance={16}>
            <TiltCard maxTilt={4} hoverScale={1.03} className="h-full">
              <div className="border border-gray-200 rounded-xl px-4 py-3.5 text-center text-sm font-medium text-gray-800 h-full flex items-center justify-center">
                {org}
              </div>
            </TiltCard>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  )
}
