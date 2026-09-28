'use client'
import { useState } from 'react'
import { Reveal } from '@/components/motion/Reveal'
import { Parallax } from '@/components/motion/Parallax'

function AccessIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12.3396 3.6275C17.147 3.6275 21.0473 7.52782 21.0473 12.3352C21.0473 17.1426 17.147 21.0429 12.3396 21.0429C7.53221 21.0429 3.63189 17.1426 3.63189 12.3352C3.63189 7.52782 7.53221 3.6275 12.3396 3.6275ZM12.3396 21.7685C14.8158 21.7685 17.0653 20.8161 18.7479 19.256L25.5054 26.0135C25.646 26.1541 25.8773 26.1541 26.0179 26.0135C26.1585 25.8729 26.1585 25.6416 26.0179 25.501L19.2604 18.7435C20.8205 17.0609 21.7729 14.8114 21.7729 12.3352C21.7729 7.12418 17.5506 2.90186 12.3396 2.90186C7.12857 2.90186 2.90625 7.12418 2.90625 12.3352C2.90625 17.5462 7.12857 21.7685 12.3396 21.7685ZM12.3396 8.34416C12.14 8.34416 11.9768 8.50743 11.9768 8.70698V11.9724H8.71138C8.51183 11.9724 8.34856 12.1356 8.34856 12.3352C8.34856 12.5347 8.51183 12.698 8.71138 12.698H11.9768V15.9634C11.9768 16.1629 12.14 16.3262 12.3396 16.3262C12.5391 16.3262 12.7024 16.1629 12.7024 15.9634V12.698H15.9678C16.1673 12.698 16.3306 12.5347 16.3306 12.3352C16.3306 12.1356 16.1673 11.9724 15.9678 11.9724H12.7024V8.70698C12.7024 8.50743 12.5391 8.34416 12.3396 8.34416Z"
        fill="currentColor"
      />
    </svg>
  )
}
function IntakeIcon() {
  return (
    <svg width="14" height="20" viewBox="0 0 18 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M11.6103 3.62821H5.80513C5.00239 3.62821 4.35385 2.97966 4.35385 2.17692C4.35385 1.37418 5.00239 0.725641 5.80513 0.725641H11.6103C12.413 0.725641 13.0615 1.37418 13.0615 2.17692C13.0615 2.97966 12.413 3.62821 11.6103 3.62821ZM11.6103 4.35385C12.8121 4.35385 13.7872 3.37877 13.7872 2.17692H14.5128C15.7147 2.17692 16.6897 3.152 16.6897 4.35385V20.3179C16.6897 21.5198 15.7147 22.4949 14.5128 22.4949H2.90256C1.70072 22.4949 0.725641 21.5198 0.725641 20.3179V4.35385C0.725641 3.152 1.70072 2.17692 2.90256 2.17692H3.62821C3.62821 3.37877 4.60329 4.35385 5.80513 4.35385H11.6103ZM13.6647 1.45128C13.3654 0.607724 12.5581 0 11.6103 0H5.80513C4.85726 0 4.04998 0.607724 3.75066 1.45128H2.90256C1.30162 1.45128 0 2.7529 0 4.35385V20.3179C0 21.9189 1.30162 23.2205 2.90256 23.2205H14.5128C16.1138 23.2205 17.4154 21.9189 17.4154 20.3179V4.35385C17.4154 2.7529 16.1138 1.45128 14.5128 1.45128H13.6647Z"
        fill="currentColor"
      />
    </svg>
  )
}
function VisitIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M14.5128 13.0613C16.9165 13.0613 18.8667 11.1111 18.8667 8.70742C18.8667 6.30373 16.9165 4.35357 14.5128 4.35357C12.1091 4.35357 10.159 6.30373 10.159 8.70742C10.159 11.1111 12.1091 13.0613 14.5128 13.0613ZM14.5128 3.62793C17.3201 3.62793 19.5923 5.90009 19.5923 8.70742C19.5923 11.5147 17.3201 13.7869 14.5128 13.7869C11.7055 13.7869 9.43333 11.5147 9.43333 8.70742C9.43333 5.90009 11.7055 3.62793 14.5128 3.62793ZM13.0615 16.6895C9.85511 16.6895 7.25641 19.2882 7.25641 22.4946V24.3087C7.25641 24.5082 7.09314 24.6715 6.89359 24.6715C6.69404 24.6715 6.53077 24.5082 6.53077 24.3087V22.4946C6.53077 18.8891 9.45601 15.9638 13.0615 15.9638H15.9641C19.5696 15.9638 22.4949 18.8891 22.4949 22.4946V24.3087C22.4949 24.5082 22.3316 24.6715 22.1321 24.6715C21.9325 24.6715 21.7692 24.5082 21.7692 24.3087V22.4946C21.7692 19.2882 19.1705 16.6895 15.9641 16.6895H13.0615ZM19.5651 13.9139C19.742 13.7416 19.9143 13.5556 20.073 13.3651C20.581 13.6327 21.157 13.7824 21.7692 13.7824C23.7738 13.7824 25.3974 12.1587 25.3974 10.1542C25.3974 8.14958 23.7738 6.52596 21.7692 6.52596C21.6604 6.52596 21.5515 6.53049 21.4427 6.53956C21.3701 6.2992 21.2794 6.0679 21.1842 5.8366C21.3747 5.80939 21.5742 5.79578 21.7692 5.79578C24.1729 5.79578 26.1231 7.74594 26.1231 10.1496C26.1231 12.5533 24.1729 14.5035 21.7692 14.5035C20.9665 14.5035 20.2136 14.2858 19.5651 13.9048V13.9139ZM7.25641 5.80485C7.45596 5.80485 7.65098 5.81846 7.84146 5.84567C7.74168 6.07243 7.65551 6.30827 7.58295 6.54863C7.4741 6.53956 7.36526 6.53503 7.25641 6.53503C5.25183 6.53503 3.62821 8.15865 3.62821 10.1632C3.62821 12.1678 5.25183 13.7914 7.25641 13.7914C7.86867 13.7914 8.44465 13.6418 8.9526 13.3742C9.11133 13.5647 9.28367 13.7461 9.46055 13.923C8.81654 14.3039 8.06369 14.5216 7.25641 14.5216C4.85272 14.5216 2.90256 12.5715 2.90256 10.1678C2.90256 7.76408 4.85272 5.81392 7.25641 5.81392V5.80485ZM22.8486 17.4151C22.6763 17.1657 22.4903 16.9208 22.2908 16.6895H22.8532C26.2591 16.6895 29.0211 19.4514 29.0211 22.8574V24.3087C29.0211 24.5082 28.8578 24.6715 28.6583 24.6715C28.4587 24.6715 28.2955 24.5082 28.2955 24.3087V22.8574C28.2955 19.8505 25.86 17.4151 22.8532 17.4151H22.8486ZM6.17248 17.4151H6.16795C3.16107 17.4151 0.725641 19.8505 0.725641 22.8574V24.3087C0.725641 24.5082 0.562372 24.6715 0.362821 24.6715C0.163269 24.6715 0 24.5082 0 24.3087V22.8574C0 19.4514 2.76197 16.6895 6.16795 16.6895H6.73032C6.5353 16.9208 6.34936 17.1657 6.17248 17.4151Z"
        fill="currentColor"
      />
    </svg>
  )
}
function CareIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M23.2205 5.07916H5.80513C4.60329 5.07916 3.62821 6.05424 3.62821 7.25608V18.1407H2.90256V7.25608C2.90256 5.65513 4.20418 4.35352 5.80513 4.35352H23.2205C24.8215 4.35352 26.1231 5.65513 26.1231 7.25608V18.1407H25.3974V7.25608C25.3974 6.05424 24.4224 5.07916 23.2205 5.07916ZM0.870769 21.0433C0.789135 21.0433 0.725641 21.1068 0.725641 21.1884C0.725641 22.7122 1.95923 23.9458 3.48308 23.9458H25.5426C27.0664 23.9458 28.3 22.7122 28.3 21.1884C28.3 21.1068 28.2365 21.0433 28.1549 21.0433H0.870769ZM0 21.1884C0 20.7077 0.390032 20.3176 0.870769 20.3176H28.1549C28.6356 20.3176 29.0256 20.7077 29.0256 21.1884C29.0256 23.1113 27.4655 24.6715 25.5426 24.6715H3.48308C1.56013 24.6715 0 23.1113 0 21.1884Z"
        fill="currentColor"
      />
    </svg>
  )
}
function ManagementIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M14.5078 2.90234C14.6846 2.90234 14.8388 3.02933 14.8661 3.20621L18.1405 23.5151L21.0431 6.10424C21.0703 5.9319 21.2245 5.80037 21.3968 5.80037C21.5692 5.80037 21.7234 5.92736 21.7551 6.0997L23.5193 15.9639H26.4808C26.6804 15.9639 26.8437 16.1272 26.8437 16.3267C26.8437 16.5263 26.6804 16.6895 26.4808 16.6895H23.2155C23.0386 16.6895 22.8889 16.5625 22.8572 16.3902L21.415 8.2993L18.4943 25.819C18.4671 25.9959 18.3129 26.1229 18.136 26.1229C17.9591 26.1229 17.8049 25.9913 17.7777 25.819L14.5078 5.5464L11.2379 25.819C11.2106 25.9959 11.0564 26.1229 10.8796 26.1229C10.7027 26.1229 10.5485 25.9959 10.5213 25.819L7.60058 8.2993L6.15837 16.3902C6.12662 16.5625 5.97696 16.6895 5.80008 16.6895H2.5347C2.33514 16.6895 2.17188 16.5263 2.17188 16.3267C2.17188 16.1272 2.33514 15.9639 2.5347 15.9639H5.49622L7.2559 6.10424C7.28764 5.9319 7.43731 5.80491 7.61418 5.80491C7.79106 5.80491 7.94072 5.9319 7.96793 6.10877L10.8705 23.5196L14.145 3.21074C14.1722 3.03387 14.3264 2.90688 14.5032 2.90688L14.5078 2.90234Z"
        fill="currentColor"
      />
    </svg>
  )
}

interface Segment {
  id: string
  label: string
  Icon: () => JSX.Element
  title: string
  bullets: string[]
}

// Only "Access / Discovery" is the design's own copy; the other four follow
// the same shape, grounded in the modules this product actually ships.
const SEGMENTS: Segment[] = [
  {
    id: 'access',
    label: 'Access',
    Icon: AccessIcon,
    title: 'Access / Discovery',
    bullets: [
      'Patient Registration',
      'Appointment Management',
      'Electronic Medical Records',
      'Lab Orders & Results',
      'Inpatient Ward Management',
    ],
  },
  {
    id: 'intake',
    label: 'Intake',
    Icon: IntakeIcon,
    title: 'Intake / Registration',
    bullets: [
      'Digital Intake Forms',
      'Insurance & HMO Verification',
      'Vitals Capture',
      'Triage & Queueing',
      'Consent & Document Upload',
    ],
  },
  {
    id: 'visit',
    label: 'Visit',
    Icon: VisitIcon,
    title: 'Visit / Consultation',
    bullets: [
      'Doctor Consultation Workspace',
      'Diagnosis & Clinical Notes',
      'e-Prescriptions',
      'Lab & Imaging Orders',
      'Referrals',
    ],
  },
  {
    id: 'care',
    label: 'Care',
    Icon: CareIcon,
    title: 'Care / Treatment',
    bullets: [
      'Pharmacy & Drug Dispensing',
      'Ward & Bed Management',
      'Care Plans & Follow-ups',
      'Nursing Charting',
      'Discharge Summaries',
    ],
  },
  {
    id: 'management',
    label: 'Management',
    Icon: ManagementIcon,
    title: 'Management / Operations',
    bullets: [
      'Staff & Role Management',
      'Billing & Invoicing',
      'HMO Claims',
      'Reports & Analytics',
      'Inventory Management',
    ],
  },
]

const SLICE_DEG = 360 / SEGMENTS.length
const BADGE_RADIUS = 33 // percent from center, at rotation = 0 (segment's "home" angle) - leaves room for the label before the rim
const INNER_R = 9 // SVG units (viewBox 0-100): divider lines start just past the centre circle
const OUTER_R = 49.6

/** Home angle (deg) for segment i when the wheel itself is unrotated - matches SEGMENTS order: top, then clockwise. */
function homeAngle(i: number) {
  return -90 + i * SLICE_DEG
}

/** Boundary between segment i and i+1 - the angle a divider line is drawn at. */
const BOUNDARY_ANGLES = SEGMENTS.map((_, i) => homeAngle(i) + SLICE_DEG / 2)

function polar(angleDeg: number, r: number) {
  const rad = angleDeg * (Math.PI / 180)
  return { x: 50 + r * Math.cos(rad), y: 50 + r * Math.sin(rad) }
}

function badgePosition(angleDeg: number) {
  const rad = angleDeg * (Math.PI / 180)
  return {
    left: `${50 + BADGE_RADIUS * Math.cos(rad)}%`,
    top: `${50 + BADGE_RADIUS * Math.sin(rad)}%`,
  }
}

/**
 * A real spin-the-wheel mechanic: the coloured disc (and the badges fixed to
 * it) physically rotates so the chosen segment lands under the fixed pointer
 * at the top - the pointer and centre label never move. Each badge counter-
 * rotates against the wheel's own rotation so its icon/label stay upright.
 */
export function PracticeExperienceWheel() {
  const [active, setActive] = useState(0)
  const [rotation, setRotation] = useState(0)
  const current = SEGMENTS[active]

  function select(i: number) {
    // Rotate by the shortest step from the CURRENT segment to the clicked one,
    // relative to the wheel's current (accumulated) rotation - not an absolute
    // "-i*72". Otherwise clicking back to segment 0 after stepping forward
    // through the rest snaps rotation back to 0 and spins the long way round
    // in the opposite direction. Wrapping past the last segment now just
    // keeps spinning the same way it was already going.
    let diff = i - active
    if (diff > SEGMENTS.length / 2) diff -= SEGMENTS.length
    if (diff < -SEGMENTS.length / 2) diff += SEGMENTS.length
    setRotation((r) => r - diff * SLICE_DEG)
    setActive(i)
  }

  return (
    <Reveal fromScale={0.94} className="block">
    <section className="bg-gray-50 rounded-3xl p-6 sm:p-10 lg:p-14">
      <div className="text-center max-w-2xl mx-auto mb-10">
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">Oudmed Patient and practice Experience</h2>
        <p className="text-gray-500 mt-3">
          No more switching between systems, hunting for patient data or wondering where your revenue stands, just
          one unify experience that works for everyone
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
        <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm">
          <h3 className="flex items-baseline gap-2 text-lg font-bold text-gray-900">
            <span className="text-gray-400">{active + 1}</span> {current.title}
          </h3>
          <ul className="mt-4 space-y-2.5">
            {current.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2 text-sm text-gray-600">
                <span className="w-1.5 h-1.5 rounded-sm bg-gray-300 mt-1.5 flex-shrink-0" />
                {b}
              </li>
            ))}
          </ul>
          <a
            href="/signup"
            className="inline-block mt-6 rounded-lg bg-primary text-white px-5 py-2.5 text-sm font-semibold hover:brightness-95 transition"
          >
            Schedule Demo
          </a>
        </div>

        <Parallax strength={14} className="relative mx-auto w-full max-w-[440px] aspect-square">
          {/* The wheel itself: disc + dividers + badges, all rotating as one unit. */}
          <div
            className="absolute inset-0 transition-transform duration-700 ease-out"
            style={{ transform: `rotate(${rotation}deg)` }}
          >
            {/* SVG rather than a CSS conic-gradient: exact, crisp divider lines with
                no antialiasing seams once the parent is rotated. */}
            <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full" style={{ overflow: 'visible' }}>
              <circle cx="50" cy="50" r={OUTER_R} fill="var(--brand-primary, #3366E3)" />
              {BOUNDARY_ANGLES.map((deg) => {
                const inner = polar(deg, INNER_R)
                const outer = polar(deg, OUTER_R)
                return (
                  <line
                    key={deg}
                    x1={inner.x}
                    y1={inner.y}
                    x2={outer.x}
                    y2={outer.y}
                    stroke="rgba(255,255,255,0.55)"
                    strokeWidth={0.6}
                  />
                )
              })}
            </svg>
            {SEGMENTS.map((seg, i) => {
              const isActive = i === active
              const p = badgePosition(homeAngle(i))
              return (
                <button
                  key={seg.id}
                  type="button"
                  onClick={() => select(i)}
                  aria-pressed={isActive}
                  aria-label={seg.label}
                  style={{ left: p.left, top: p.top, transform: `translate(-50%, -50%) rotate(${-rotation}deg)` }}
                  className="absolute flex flex-col items-center gap-2 focus:outline-none"
                >
                  <span
                    className={`w-16 h-16 rounded-full flex items-center justify-center shadow-sm transition-colors ${
                      isActive ? 'bg-blue-200 text-gray-900' : 'bg-white text-primary'
                    }`}
                  >
                    <seg.Icon />
                  </span>
                  <span className="text-white text-sm font-medium drop-shadow-sm whitespace-nowrap">{seg.label}</span>
                </button>
              )
            })}
          </div>

          {/* Fixed centre + pointer - never rotates. */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className="absolute"
              style={{
                top: '50%',
                left: '50%',
                width: '38%',
                aspectRatio: '1 / 1',
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div
                className="absolute left-1/2 -translate-x-1/2"
                style={{
                  top: '-11px',
                  width: 0,
                  height: 0,
                  borderLeft: '12px solid transparent',
                  borderRight: '12px solid transparent',
                  borderBottom: '16px solid white',
                }}
              />
              <div className="w-full h-full rounded-full bg-white shadow-md flex items-center justify-center text-center px-4">
                <span className="text-sm font-bold text-gray-900 leading-snug">Oudmed Practice Experience</span>
              </div>
            </div>
          </div>
        </Parallax>
      </div>
    </section>
    </Reveal>
  )
}
