'use client'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/kit'
import type { TourStep } from '@/lib/onboarding/types'
import { TourProgress } from './TourProgress'
import type { Rect } from './Spotlight'

type Placement = 'top' | 'bottom' | 'left' | 'right'
const GAP = 14
const MARGIN = 12
const CARD_W = 340

function place(
  rect: Rect,
  pop: { w: number; h: number },
  pref: Placement,
  vw: number,
  vh: number,
): { top: number; left: number; side: Placement } {
  const fits = (side: Placement) => {
    if (side === 'top') return rect.top - GAP - pop.h >= MARGIN
    if (side === 'bottom') return rect.top + rect.height + GAP + pop.h <= vh - MARGIN
    if (side === 'left') return rect.left - GAP - pop.w >= MARGIN
    return rect.left + rect.width + GAP + pop.w <= vw - MARGIN
  }
  const opposite: Record<Placement, Placement> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
  const order: Placement[] = [pref, opposite[pref], 'bottom', 'top', 'right', 'left']
  const side = order.find(fits) ?? pref

  let top: number
  let left: number
  if (side === 'top') {
    top = rect.top - GAP - pop.h
    left = rect.left + rect.width / 2 - pop.w / 2
  } else if (side === 'bottom') {
    top = rect.top + rect.height + GAP
    left = rect.left + rect.width / 2 - pop.w / 2
  } else if (side === 'left') {
    left = rect.left - GAP - pop.w
    top = rect.top + rect.height / 2 - pop.h / 2
  } else {
    left = rect.left + rect.width + GAP
    top = rect.top + rect.height / 2 - pop.h / 2
  }
  return {
    top: Math.min(Math.max(MARGIN, top), vh - pop.h - MARGIN),
    left: Math.min(Math.max(MARGIN, left), vw - pop.w - MARGIN),
    side,
  }
}

export function TourPopover({
  rect,
  step,
  stepIndex,
  total,
  isFirst,
  isLast,
  onNext,
  onBack,
  onSkip,
  onFinish,
}: {
  rect: Rect | null
  step: TourStep
  stepIndex: number
  total: number
  isFirst: boolean
  isLast: boolean
  onNext: () => void
  onBack: () => void
  onSkip: () => void
  onFinish: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number; side: Placement } | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const titleId = useId()
  const bodyId = useId()

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const on = () => setIsMobile(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // position against the target (desktop only)
  useLayoutEffect(() => {
    if (isMobile || !rect || !ref.current) {
      setPos(null)
      return
    }
    const el = ref.current
    const measure = () => {
      const r = el.getBoundingClientRect()
      setPos(place(rect, { w: r.width || CARD_W, h: r.height || 180 }, step.placement ?? 'bottom', window.innerWidth, window.innerHeight))
    }
    measure()
  }, [rect, step.placement, step.id, isMobile, total])

  // focus management + keyboard
  useEffect(() => {
    restoreFocus.current = (document.activeElement as HTMLElement) ?? null
    const node = ref.current
    const focusables = () =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((e) => !e.hasAttribute('disabled'))
        : []
    focusables()[0]?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onSkip()
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        isLast ? onFinish() : onNext()
      } else if (e.key === 'Tab') {
        const f = focusables()
        if (f.length === 0) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      restoreFocus.current?.focus?.()
    }
  }, [step.id, isLast, onNext, onFinish, onSkip])

  if (typeof document === 'undefined') return null
  const showAnchored = !isMobile && rect && pos
  // On desktop, wait for the first measurement so the card does not flash in as
  // a bottom sheet before it is placed against the target.
  const awaitingPlacement = !isMobile && rect && !pos

  const style: React.CSSProperties = showAnchored
    ? { position: 'fixed', top: pos!.top, left: pos!.left, width: CARD_W }
    : {
        position: 'fixed',
        left: MARGIN,
        right: MARGIN,
        bottom: MARGIN,
        maxWidth: 520,
        margin: '0 auto',
        ...(awaitingPlacement ? { opacity: 0, pointerEvents: 'none' as const } : {}),
      }

  return createPortal(
    <>
      <span aria-live="polite" className="sr-only">
        {`Step ${stepIndex + 1} of ${total}. ${step.title}`}
      </span>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="z-[1201] rounded-2xl border border-gray-100 bg-white p-5 shadow-2xl font-hanken"
        style={style}
      >
        {showAnchored && <Arrow side={pos!.side} rect={rect!} popTop={pos!.top} popLeft={pos!.left} />}

        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-base font-bold text-gray-900">
            {step.title}
          </h2>
          <button
            onClick={onSkip}
            className="-mr-1 -mt-1 rounded p-1 text-gray-400 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            aria-label="Skip the tour"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <p id={bodyId} className="mt-1.5 text-sm leading-relaxed text-gray-600">
          {step.body}
        </p>

        <div className="mt-4 flex items-end justify-between gap-3">
          <TourProgress step={stepIndex} total={total} />
          <div className="flex flex-shrink-0 gap-2">
            {!isFirst && (
              <Button variant="secondary" onClick={onBack}>
                Back
              </Button>
            )}
            {isLast ? (
              <Button variant="primary" onClick={onFinish}>
                Finish
              </Button>
            ) : (
              <Button variant="primary" onClick={onNext}>
                Next
              </Button>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}

function Arrow({
  side,
  rect,
  popTop,
  popLeft,
}: {
  side: Placement
  rect: Rect
  popTop: number
  popLeft: number
}) {
  const S = 10
  const base: React.CSSProperties = {
    position: 'absolute',
    width: S,
    height: S,
    background: 'white',
    transform: 'rotate(45deg)',
  }
  const targetCX = rect.left + rect.width / 2
  const targetCY = rect.top + rect.height / 2
  if (side === 'top') return <span style={{ ...base, bottom: -S / 2, left: clamp(targetCX - popLeft, 16, CARD_W - 16), borderRight: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6' }} />
  if (side === 'bottom') return <span style={{ ...base, top: -S / 2, left: clamp(targetCX - popLeft, 16, CARD_W - 16), borderLeft: '1px solid #f3f4f6', borderTop: '1px solid #f3f4f6' }} />
  if (side === 'left') return <span style={{ ...base, right: -S / 2, top: clamp(targetCY - popTop, 16, 999), borderRight: '1px solid #f3f4f6', borderTop: '1px solid #f3f4f6' }} />
  return <span style={{ ...base, left: -S / 2, top: clamp(targetCY - popTop, 16, 999), borderLeft: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6' }} />
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
