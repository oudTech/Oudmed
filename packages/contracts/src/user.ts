export type HmsRole =
  | 'SUPER_ADMIN'
  | 'HOSPITAL_ADMIN'
  | 'RECEPTIONIST'
  | 'DOCTOR'
  | 'NURSE'
  | 'PHARMACIST'
  | 'LAB_STAFF'
  | 'ACCOUNTANT'

export interface UserClaimsDTO {
  userId: string
  tenantId: string
  role: HmsRole | null
  email: string
  name: string
}

/** Persisted guided-tour / onboarding progress for one user. */
export interface OnboardingState {
  status: 'not_started' | 'in_progress' | 'completed' | 'skipped'
  currentTour: string | null
  currentStep: number
  completedTours: string[]
  skippedTours: string[]
}

/**
 * Per-user preferences (self-scoped, `GET/PATCH /api/me/preferences`). Free-form
 * but only these keys are writable and each PATCH deep-merges `onboarding`.
 */
export interface UserPreferencesDTO {
  onboarding?: Partial<OnboardingState>
  /** feature-discovery callouts the user has already dismissed */
  seenFeatures?: string[]
}
