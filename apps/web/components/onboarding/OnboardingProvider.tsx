'use client'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useConfirm, useToast } from '@/components/ui/feedback'
import { can } from '@/lib/permissions'
import type { OnboardingState, Tour, TourId, TourStep } from '@/lib/onboarding/types'
import { usePreferences } from '@/lib/onboarding/persistence'
import { toursForRole, tourById } from '@/lib/onboarding/tours'
import { track } from '@/lib/onboarding/analytics'
import { Spotlight, type Rect } from './Spotlight'
import { TourPopover } from './TourPopover'
import { WelcomeModal } from './WelcomeModal'

interface OnboardingContextValue {
  state: OnboardingState
  ready: boolean
  activeTourId: TourId | null
  availableTours: Tour[]
  start: (tourId: TourId) => void
  restart: (tourId?: TourId) => void
  openWelcome: () => void
  seenFeatures: string[]
  markFeatureSeen: (id: string) => void
}

const Ctx = createContext<OnboardingContextValue | null>(null)

export function useOnboarding() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useOnboarding must be used within <OnboardingProvider>')
  return ctx
}

// ── helpers ──────────────────────────────────────────────────────────────────
function waitForElement(selector: string, timeout = 5000): Promise<HTMLElement | null> {
  const found = () => {
    const el = document.querySelector<HTMLElement>(selector)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return r.width === 0 && r.height === 0 ? null : el
  }
  const now = found()
  if (now) return Promise.resolve(now)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      obs.disconnect()
      resolve(null)
    }, timeout)
    const obs = new MutationObserver(() => {
      const el = found()
      if (el) {
        clearTimeout(timer)
        obs.disconnect()
        resolve(el)
      }
    })
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-tour'] })
  })
}

function waitForPath(path: string, timeout = 4000): Promise<void> {
  if (window.location.pathname === path) return Promise.resolve()
  return new Promise((resolve) => {
    const start = Date.now()
    const iv = setInterval(() => {
      if (window.location.pathname === path || Date.now() - start > timeout) {
        clearInterval(iv)
        resolve()
      }
    }, 50)
  })
}

const dedupe = (a: string[]) => [...new Set(a)]

// ── provider ─────────────────────────────────────────────────────────────────
export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession()
  const role = session?.role ?? null
  const hospitalName = session?.tenant?.name ?? 'your workspace'
  const pathname = usePathname()
  const router = useRouter()
  const toast = useToast()
  const confirm = useConfirm()
  const { ready, onboarding, patchOnboarding, seenFeatures, markFeatureSeen } = usePreferences()

  const availableTours = useMemo(() => toursForRole(role), [role])

  const [activeTour, setActiveTour] = useState<Tour | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [resolving, setResolving] = useState(false)
  const [welcomeOpen, setWelcomeOpen] = useState(false)

  const activeEl = useRef<HTMLElement | null>(null)
  const welcomeShown = useRef(false)
  const reducedMotion = useRef(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => (reducedMotion.current = mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const buildTour = useCallback(
    (tour: Tour): Tour => ({
      ...tour,
      steps: tour.steps.filter((s) => !s.permission || can(role, s.permission)),
    }),
    [role],
  )

  // ── start / resume ─────────────────────────────────────────────────────────
  const start = useCallback(
    (tourId: TourId) => {
      const raw = tourById(role, tourId)
      if (!raw) return
      const tour = buildTour(raw)
      if (tour.steps.length === 0) {
        toast('Nothing to show here yet.', 'info')
        return
      }
      setActiveTour(tour)
      setStepIndex(0)
      setRect(null)
      patchOnboarding({ status: 'in_progress', currentTour: tourId, currentStep: 0 })
      track('onboarding_started', { tour: tourId, role })
    },
    [role, buildTour, patchOnboarding, toast],
  )

  const restart = useCallback(
    (tourId?: TourId) => {
      track('onboarding_restarted', { tour: tourId ?? 'getting-around' })
      start(tourId ?? 'getting-around')
    },
    [start],
  )

  const close = useCallback(() => {
    setActiveTour(null)
    setRect(null)
    activeEl.current = null
  }, [])

  const goToStep = useCallback(
    (i: number) => {
      setStepIndex(i)
      patchOnboarding({ currentStep: i })
    },
    [patchOnboarding],
  )

  const finish = useCallback(() => {
    if (!activeTour) return
    const completedTours = dedupe([...onboarding.completedTours, activeTour.id])
    const allDone = availableTours.every((t) => completedTours.includes(t.id))
    patchOnboarding({
      status: allDone ? 'completed' : 'in_progress',
      currentTour: null,
      currentStep: 0,
      completedTours,
    })
    track('onboarding_completed', { tour: activeTour.id })
    const finishedId = activeTour.id
    close()
    const nextTour = availableTours.find((t) => !completedTours.includes(t.id))
    if (nextTour) {
      confirm({
        title: 'Nice work',
        body: `Ready for the "${nextTour.title}" walkthrough? It takes a couple of minutes and you can stop any time.`,
        confirmLabel: 'Start it',
      }).then((yes) => {
        if (yes) start(nextTour.id)
        else toast('You can pick it up any time from Support.', 'info')
      })
    } else {
      toast('That’s the tour. Replay it any time from Support.', 'success')
    }
    return finishedId
  }, [activeTour, onboarding.completedTours, availableTours, patchOnboarding, close, confirm, start, toast])

  const advance = useCallback(() => {
    if (!activeTour) return
    if (stepIndex + 1 >= activeTour.steps.length) finish()
    else goToStep(stepIndex + 1)
  }, [activeTour, stepIndex, finish, goToStep])

  const next = useCallback(() => {
    if (!activeTour) return
    track('onboarding_step_completed', { tour: activeTour.id, step: activeTour.steps[stepIndex]?.id })
    advance()
  }, [activeTour, stepIndex, advance])

  const back = useCallback(() => goToStep(Math.max(0, stepIndex - 1)), [stepIndex, goToStep])

  const skip = useCallback(() => {
    if (!activeTour) return
    confirm({
      title: 'Leave the tour?',
      body: 'You can restart it any time from Support.',
      confirmLabel: 'Leave',
    }).then((yes) => {
      if (!yes) return
      patchOnboarding({
        status: onboarding.status === 'completed' ? 'completed' : 'skipped',
        currentTour: null,
        skippedTours: dedupe([...onboarding.skippedTours, activeTour.id]),
      })
      track('onboarding_abandoned', { tour: activeTour.id, atStep: stepIndex })
      close()
    })
  }, [activeTour, stepIndex, onboarding.status, onboarding.skippedTours, confirm, patchOnboarding, close])

  // ── resolve the current step's target (navigate + wait + measure) ───────────
  useEffect(() => {
    if (!activeTour) return
    const step: TourStep | undefined = activeTour.steps[stepIndex]
    if (!step) return
    let cancelled = false
    setResolving(true)
    setRect(null)
    activeEl.current = null

    ;(async () => {
      try {
        if (step.route && window.location.pathname !== step.route) {
          router.push(step.route)
          await waitForPath(step.route)
        }
        if (cancelled) return
        const el = await waitForElement(step.target, 5000)
        if (cancelled) return
        if (!el) {
          if (!step.optional) {
            // eslint-disable-next-line no-console
            console.warn(`[onboarding] step target not found, skipping: ${step.target}`)
            track('onboarding_step_skipped', { tour: activeTour.id, step: step.id, reason: 'target-missing' })
          }
          advance()
          return
        }
        el.scrollIntoView({
          block: 'center',
          inline: 'center',
          behavior: reducedMotion.current ? 'auto' : 'smooth',
        })
        await new Promise((r) => setTimeout(r, reducedMotion.current ? 0 : 220))
        if (cancelled) return
        activeEl.current = el
        const r = el.getBoundingClientRect()
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
        setResolving(false)
        track('onboarding_step_viewed', { tour: activeTour.id, step: step.id, index: stepIndex })
      } catch (e) {
        // never let the tour take the app down
        // eslint-disable-next-line no-console
        console.warn('[onboarding] step resolution failed, ending tour', e)
        if (!cancelled) close()
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTour, stepIndex])

  // ── keep the spotlight glued to the target on scroll / resize ───────────────
  useEffect(() => {
    if (!activeTour || resolving) return
    let raf = 0
    const update = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const el = activeEl.current
        if (!el) return
        const r = el.getBoundingClientRect()
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      })
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    let ro: ResizeObserver | null = null
    if (activeEl.current && 'ResizeObserver' in window) {
      ro = new ResizeObserver(update)
      ro.observe(activeEl.current)
    }
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      ro?.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [activeTour, stepIndex, resolving])

  // ── first-login welcome ────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !role || welcomeShown.current || activeTour) return
    if (onboarding.status === 'not_started' && pathname === '/dashboard') {
      welcomeShown.current = true
      setWelcomeOpen(true)
    }
  }, [ready, role, onboarding.status, pathname, activeTour])

  const value = useMemo<OnboardingContextValue>(
    () => ({
      state: onboarding,
      ready,
      activeTourId: activeTour?.id ?? null,
      availableTours,
      start,
      restart,
      openWelcome: () => setWelcomeOpen(true),
      seenFeatures,
      markFeatureSeen,
    }),
    [onboarding, ready, activeTour, availableTours, start, restart, seenFeatures, markFeatureSeen],
  )

  const step = activeTour?.steps[stepIndex]

  return (
    <Ctx.Provider value={value}>
      {children}

      <WelcomeModal
        open={welcomeOpen}
        hospitalName={hospitalName}
        onStart={() => {
          setWelcomeOpen(false)
          start('getting-around')
        }}
        onLater={() => setWelcomeOpen(false)}
        onSkip={() => {
          setWelcomeOpen(false)
          patchOnboarding({ status: 'skipped' })
          track('onboarding_abandoned', { tour: null, reason: 'welcome-skip' })
        }}
      />

      {activeTour && step && !resolving && rect && (
        <>
          <Spotlight
            rect={rect}
            interactive={!!step.spotlightClicks}
            reducedMotion={reducedMotion.current}
          />
          <TourPopover
            rect={rect}
            step={step}
            stepIndex={stepIndex}
            total={activeTour.steps.length}
            isFirst={stepIndex === 0}
            isLast={stepIndex === activeTour.steps.length - 1}
            onNext={next}
            onBack={back}
            onSkip={skip}
            onFinish={finish}
          />
        </>
      )}
    </Ctx.Provider>
  )
}
