'use client'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useOnboarding, SectionProgress } from '@/components/onboarding'
import type { TourId } from '@/lib/onboarding/types'

/* Role-aware "what to do first" copy for the Getting started card. */
const FIRST_STEPS: Record<string, string[]> = {
  RECEPTIONIST: [
    'Register a walk-in or expected patient from Patients > Add new patient.',
    'Book their visit on the Schedule, or check them in if they already have an appointment.',
    'Take payment or start an invoice from Billing once the visit is done.',
  ],
  DOCTOR: [
    'Open Schedule to see the patients booked with you today.',
    'Open a patient to read their chart, then Start consultation to record the encounter.',
    'Add the complaint, vitals, diagnosis, prescription and any lab orders inside the consultation workspace.',
  ],
  NURSE: [
    'Use Schedule and Wards & Beds to see who is expected and who is admitted.',
    'Record vitals and observations from the patient chart.',
  ],
  PHARMACIST: [
    'Work the queue on Pharmacy > Dispensing - each row is a prescription waiting to be filled.',
    'Keep the catalogue and stock current on Pharmacy > Inventory so prescribing stays accurate.',
  ],
  LAB_STAFF: [
    'Open Laboratory to see the worklist of ordered tests.',
    'Enter results against each order so they flow back to the requesting doctor.',
  ],
  ACCOUNTANT: [
    'Reconcile the day from Billing, then generate and submit HMO demands from Claims.',
    'Record remittances against claims and watch receivables age.',
    'Use Reports for collections, revenue mix and the exportable payment ledger.',
  ],
  HOSPITAL_ADMIN: [
    'Set up master data first: services, departments and insurance providers in Administration.',
    'Add your staff and their roles in Human Resources.',
    'Set hospital profile, branding and document numbering in Settings.',
  ],
  SUPER_ADMIN: [
    'Set up master data first: services, departments and insurance providers in Administration.',
    'Add your staff and their roles in Human Resources.',
    'Set hospital profile, branding and document numbering in Settings.',
  ],
}

const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: 'Enter', what: 'During a tour: go to the next step' },
  { keys: 'Esc', what: 'During a tour: leave (you are asked to confirm)' },
  { keys: 'Tab', what: 'Move focus between the tour buttons' },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Do I have to finish the tour in one go?',
    a: 'No. Your place is saved as you go, on the server, so you can stop and pick it up later on any device.',
  },
  {
    q: 'Why can I not see a module a colleague has?',
    a: 'The sidebar and every tour step follow your role. You only see what you are allowed to use.',
  },
  {
    q: 'Something in a tour pointed at the wrong place.',
    a: 'The tour skips a step whose target it cannot find and carries on. Let an admin know which step so we can fix the anchor.',
  },
]

export default function SupportPage() {
  const { data: session } = useSession()
  const role = session?.role ?? ''
  const { availableTours, state, restart } = useOnboarding()

  const firstSteps = FIRST_STEPS[role] ?? [
    'Use the sidebar to move between the parts of the hospital you have access to.',
    'Start with the "Getting around" tour below for a quick orientation.',
  ]

  const sections = availableTours.map((t) => ({
    label: t.section,
    done: state.completedTours.includes(t.id),
    current:
      state.currentTour === t.id ? Math.min(state.currentStep + 1, t.steps.length) : undefined,
    total: state.currentTour === t.id ? t.steps.length : undefined,
  }))

  return (
    <div className="flex flex-col h-full bg-[#F7F9FC] overflow-hidden">
      <div className="px-8 pt-7 pb-4 flex-shrink-0 bg-white border-b border-[#D6DEE8]">
        <h1 className="text-2xl font-bold text-gray-900">Help &amp; guided tours</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Replay a walkthrough, brush up on how the work flows, or get in touch.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6 max-w-3xl space-y-6">
        {/* ── Guided tours ── */}
        <Card
          title="Guided tours"
          subtitle="Each one spotlights the screen and explains why each step matters. Stop any time."
        >
          <ul className="divide-y divide-gray-100">
            {availableTours.map((t) => {
              const done = state.completedTours.includes(t.id)
              return (
                <li key={t.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {t.title}
                      {done && <span className="ml-2 text-xs font-medium text-[#0DA76C]">Completed</span>}
                    </p>
                    <p className="mt-0.5 text-sm text-gray-500">{t.summary}</p>
                  </div>
                  <RestartButton tourId={t.id} onClick={restart} label={done ? 'Replay' : 'Start'} />
                </li>
              )
            })}
          </ul>

          {sections.length > 1 && (
            <div className="mt-5 border-t border-gray-100 pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Your progress</p>
              <SectionProgress sections={sections} />
            </div>
          )}
        </Card>

        {/* ── Getting started ── */}
        <Card title="Getting started" subtitle="A short path through your first day">
          <ol className="space-y-2">
            {firstSteps.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm text-gray-700">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </Card>

        {/* ── Keyboard shortcuts ── */}
        <Card title="Keyboard shortcuts">
          <ul className="space-y-2">
            {SHORTCUTS.map((s) => (
              <li key={s.keys} className="flex items-center gap-3 text-sm">
                <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-600">
                  {s.keys}
                </kbd>
                <span className="text-gray-600">{s.what}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* ── FAQ ── */}
        <Card title="Questions">
          <dl className="space-y-4">
            {FAQ.map((f) => (
              <div key={f.q}>
                <dt className="text-sm font-semibold text-gray-900">{f.q}</dt>
                <dd className="mt-0.5 text-sm text-gray-500">{f.a}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {/* ── Contact ── */}
        <Card title="Still stuck?" subtitle="Reach the person who set up this hospital, or your systems administrator.">
          <a
            href="mailto:support@oudhealth.app?subject=Help%20with%20the%20HMS"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-[#2b58c9]"
          >
            Contact support
          </a>
        </Card>
      </div>
    </div>
  )
}

function RestartButton({
  tourId,
  onClick,
  label,
}: {
  tourId: TourId
  onClick: (id: TourId) => void
  label: string
}) {
  return (
    <button
      onClick={() => onClick(tourId)}
      className="flex-shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
    >
      {label}
    </button>
  )
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-6">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start justify-between gap-4 text-left"
        aria-expanded={open}
      >
        <div>
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
        </div>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className={`mt-1 flex-shrink-0 text-gray-400 transition-transform ${open ? '' : '-rotate-90'}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </section>
  )
}
