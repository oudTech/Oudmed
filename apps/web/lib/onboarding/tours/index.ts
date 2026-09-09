import type { Tour, TourId } from '../types'
import { gettingAround } from './getting-around'
import { receptionistWorkflow } from './receptionist'
import { doctorWorkflow } from './doctor'
import { adminWorkflow } from './admin'
import { nurseWorkflow } from './nurse'
import { pharmacistWorkflow } from './pharmacist'
import { labWorkflow } from './lab'
import { accountantWorkflow } from './accountant'

/**
 * Which tours a role gets, in order. Every role gets `getting-around` first,
 * then their role-specific workflow tour. SUPER_ADMIN reuses the HOSPITAL_ADMIN
 * set. A step whose `permission` the role lacks is dropped by the
 * OnboardingProvider before the tour runs.
 */
const BY_ROLE: Record<string, Tour[]> = {
  HOSPITAL_ADMIN: [gettingAround, adminWorkflow],
  SUPER_ADMIN: [gettingAround, adminWorkflow],
  RECEPTIONIST: [gettingAround, receptionistWorkflow],
  DOCTOR: [gettingAround, doctorWorkflow],
  NURSE: [gettingAround, nurseWorkflow],
  PHARMACIST: [gettingAround, pharmacistWorkflow],
  LAB_STAFF: [gettingAround, labWorkflow],
  ACCOUNTANT: [gettingAround, accountantWorkflow],
}

export function toursForRole(role: string | null | undefined): Tour[] {
  if (!role) return [gettingAround]
  return BY_ROLE[role] ?? [gettingAround]
}

export function tourById(role: string | null | undefined, id: TourId): Tour | undefined {
  return toursForRole(role).find((t) => t.id === id)
}

export { gettingAround }
