'use client'
import { useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { Reveal } from '@/components/motion/Reveal'

interface Testimonial {
  quote: string
  name: string
  title: string
}

function LeftArrowIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 65 65" fill="none" xmlns="http://www.w3.org/2000/svg">
      <mask id="path-1-inside-1_2753_3198" fill="white">
        <path d="M0 32.4C0 14.506 14.506 0 32.4 0C50.294 0 64.8 14.506 64.8 32.4C64.8 50.294 50.294 64.8 32.4 64.8C14.506 64.8 0 50.294 0 32.4Z" />
      </mask>
      <path
        d="M0 32.4M64.8 32.4M64.8 32.4M0 32.4M32.4 0M64.8 32.4M32.4 64.8M0 32.4M32.4 64.8V63.6C15.1687 63.6 1.2 49.6313 1.2 32.4H0H-1.2C-1.2 50.9568 13.8432 66 32.4 66V64.8ZM64.8 32.4H63.6C63.6 49.6313 49.6313 63.6 32.4 63.6V64.8V66C50.9568 66 66 50.9568 66 32.4H64.8ZM32.4 0V1.2C49.6313 1.2 63.6 15.1687 63.6 32.4H64.8H66C66 13.8432 50.9568 -1.2 32.4 -1.2V0ZM32.4 0V-1.2C13.8432 -1.2 -1.2 13.8432 -1.2 32.4H0H1.2C1.2 15.1687 15.1687 1.2 32.4 1.2V0Z"
        fill="#0B1632"
        mask="url(#path-1-inside-1_2753_3198)"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M29.5427 32.4L36.6137 39.471L35.1997 40.885L27.4217 33.107C27.2342 32.9195 27.1289 32.6652 27.1289 32.4C27.1289 32.1349 27.2342 31.8806 27.4217 31.693L35.1997 23.915L36.6137 25.329L29.5427 32.4Z"
        fill="black"
      />
    </svg>
  )
}

function RightArrowIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 65 65" fill="none" xmlns="http://www.w3.org/2000/svg">
      <mask id="path-1-inside-1_2753_3201" fill="white">
        <path d="M0 32.4C0 14.506 14.506 0 32.4 0C50.294 0 64.8 14.506 64.8 32.4C64.8 50.294 50.294 64.8 32.4 64.8C14.506 64.8 0 50.294 0 32.4Z" />
      </mask>
      <path
        d="M0 32.4M64.8 32.4M64.8 32.4M0 32.4M32.4 0M64.8 32.4M32.4 64.8M0 32.4M32.4 64.8V63.6C15.1687 63.6 1.2 49.6313 1.2 32.4H0H-1.2C-1.2 50.9568 13.8432 66 32.4 66V64.8ZM64.8 32.4H63.6C63.6 49.6313 49.6313 63.6 32.4 63.6V64.8V66C50.9568 66 66 50.9568 66 32.4H64.8ZM32.4 0V1.2C49.6313 1.2 63.6 15.1687 63.6 32.4H64.8H66C66 13.8432 50.9568 -1.2 32.4 -1.2V0ZM32.4 0V-1.2C13.8432 -1.2 -1.2 13.8432 -1.2 32.4H0H1.2C1.2 15.1687 15.1687 1.2 32.4 1.2V0Z"
        fill="#0B1632"
        mask="url(#path-1-inside-1_2753_3201)"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M36.8557 32.4L29.7847 39.471L31.1987 40.885L38.9767 33.107C39.1642 32.9195 39.2695 32.6652 39.2695 32.4C39.2695 32.1349 39.1642 31.8806 38.9767 31.693L31.1987 23.915L29.7847 25.329L36.8557 32.4Z"
        fill="black"
      />
    </svg>
  )
}

// Only one real testimonial exists today (John Fred). The other two below are
// placeholders with obviously fake names/hospitals - swap in real customer
// quotes here as they come in, don't ship these to production as-is.
const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      'Oudmed was the only comprehensive solution to provide unmatched provider and patient experience through configurability, flexibility, and scalability while addressing the needs of a growing organization like ours with multiple lines of service.',
    name: 'John Fred, MSW',
    title: 'Chief Executive Officer',
  },
  {
    quote:
      '[PLACEHOLDER TESTIMONIAL - replace with a real customer quote] Switching to Oudmed cut our patient check-in time in half and gave our billing team a single place to work from instead of three spreadsheets.',
    name: 'Jane Doe (placeholder)',
    title: 'Placeholder Hospital',
  },
  {
    quote:
      '[PLACEHOLDER TESTIMONIAL - replace with a real customer quote] The rollout was smoother than we expected, our staff were comfortable with the system within the first week.',
    name: 'Sam Placeholder',
    title: 'Sample Medical Center',
  },
]

const variants = {
  enter: (direction: number) => ({ opacity: 0, x: direction > 0 ? 60 : -60 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction > 0 ? -60 : 60 }),
}

export function TestimonialCarousel() {
  const [[index, direction], setState] = useState<[number, number]>([0, 0])
  const t = TESTIMONIALS[index]
  const canNavigate = TESTIMONIALS.length > 1

  function go(newIndex: number, dir: number) {
    setState([(newIndex + TESTIMONIALS.length) % TESTIMONIALS.length, dir])
  }

  return (
    <Reveal>
    <section className="max-w-6xl mx-auto px-6 py-16 sm:py-24 relative text-center">
      {canNavigate && (
        <m.button
          onClick={() => go(index - 1, -1)}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.95 }}
          className="absolute left-0 sm:left-4 top-1/2 -translate-y-1/2"
          aria-label="Previous testimonial"
        >
          <LeftArrowIcon />
        </m.button>
      )}

      <div className="max-w-2xl mx-auto overflow-hidden">
        <AnimatePresence mode="wait" custom={direction}>
          <m.div
            key={index}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="text-xl sm:text-2xl text-gray-900 leading-relaxed">&ldquo;{t.quote}&rdquo;</p>
            <p className="mt-6 font-semibold text-gray-900">{t.name}</p>
            <p className="text-sm text-primary">{t.title}</p>
          </m.div>
        </AnimatePresence>

        <div className="flex justify-center gap-1.5 mt-6">
          {TESTIMONIALS.map((_, i) => (
            <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === index ? 'bg-brand-navy' : 'bg-gray-200'}`} />
          ))}
        </div>
      </div>

      {canNavigate && (
        <m.button
          onClick={() => go(index + 1, 1)}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.95 }}
          className="absolute right-0 sm:right-4 top-1/2 -translate-y-1/2"
          aria-label="Next testimonial"
        >
          <RightArrowIcon />
        </m.button>
      )}
    </section>
    </Reveal>
  )
}
