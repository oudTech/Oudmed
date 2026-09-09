import type { Action } from '@/lib/permissions'
import type { OnboardingState } from '@oudhealth/contracts'

export type { OnboardingState }

/** Tour ids are `<audience>` + `-` + `<kind>`, e.g. `getting-around`, `doctor-workflow`. */
export type TourId = string

export interface TourStep {
  /** stable within a tour, used for analytics + resume */
  id: string
  /** navigate here first if the user is not already on this route */
  route?: string
  /** CSS selector for the element to spotlight - always a `[data-tour="..."]` */
  target: string
  title: string
  /** 1-2 short sentences. Say WHAT it is and WHY it matters, in plain language. */
  body: string
  placement?: 'top' | 'bottom' | 'left' | 'right'
  /** step is removed from the tour when `!can(role, permission)` */
  permission?: Action
  /** if the target never appears, skip silently instead of logging a warning */
  optional?: boolean
  /** let the user click the highlighted element through the spotlight hole */
  spotlightClicks?: boolean
}

export interface Tour {
  id: TourId
  title: string
  /** shown in the Help Center and the section progress view */
  section: string
  /** one-line summary for the Help Center list */
  summary: string
  steps: TourStep[]
}

export const DEFAULT_ONBOARDING: OnboardingState = {
  status: 'not_started',
  currentTour: null,
  currentStep: 0,
  completedTours: [],
  skippedTours: [],
}

export type OnboardingAnalyticsEvent =
  | 'onboarding_started'
  | 'onboarding_step_viewed'
  | 'onboarding_step_completed'
  | 'onboarding_step_skipped'
  | 'onboarding_completed'
  | 'onboarding_abandoned'
  | 'onboarding_restarted'
  | 'first_patient_created'
  | 'first_appointment_created'
  | 'first_consultation_completed'
