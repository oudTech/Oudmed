// Mirror of apps/api/src/common/permissions.ts - used to hide/disable UI.
// The API enforces the real gate; keep these in sync.

export type Action =
  | 'appointment:book'
  | 'appointment:reschedule'
  | 'appointment:edit'
  | 'appointment:check-in'
  | 'appointment:start'
  | 'appointment:complete'
  | 'appointment:cancel'
  | 'appointment:no-show'
  | 'appointment:reopen'
  | 'admission:create'
  | 'admission:edit'
  | 'admission:transfer'
  | 'admission:discharge'
  | 'ward:manage'
  | 'bed:set-status'
  | 'doctor:set-hours'
  | 'patient:register'
  | 'patient:read'
  | 'patient:edit'
  | 'patient:document'
  | 'complaint:record'
  | 'vitals:record'
  | 'diagnosis:record'
  | 'prescription:write'
  | 'prescription:dispense'
  | 'pharmacy:manage'
  | 'note:write'
  | 'order:create'
  | 'order:result'
  | 'invoice:pay'
  | 'billing:manage'
  | 'staff:manage'
  | 'admin:settings'
  | 'reports:view'
  | 'claims:manage'

// Mirror of apps/api/src/common/permissions.ts MATRIX. Kept in lockstep by
// apps/api/src/common/permissions.drift.spec.ts.
export const MATRIX: Record<Action, string[]> = {
  'appointment:book': ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'appointment:reschedule': ['RECEPTIONIST', 'NURSE', 'HOSPITAL_ADMIN'],
  'appointment:edit': ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'appointment:check-in': ['RECEPTIONIST', 'NURSE', 'HOSPITAL_ADMIN'],
  'appointment:start': ['DOCTOR', 'NURSE', 'HOSPITAL_ADMIN'],
  'appointment:complete': ['DOCTOR', 'NURSE', 'HOSPITAL_ADMIN'],
  'appointment:cancel': ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'appointment:no-show': ['RECEPTIONIST', 'NURSE', 'HOSPITAL_ADMIN'],
  'appointment:reopen': ['RECEPTIONIST', 'NURSE', 'HOSPITAL_ADMIN'],
  'admission:create': ['NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'admission:edit': ['NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'admission:transfer': ['NURSE', 'HOSPITAL_ADMIN'],
  'admission:discharge': ['DOCTOR', 'NURSE', 'HOSPITAL_ADMIN'],
  'ward:manage': ['HOSPITAL_ADMIN'],
  'bed:set-status': ['NURSE', 'HOSPITAL_ADMIN'],
  'doctor:set-hours': ['HOSPITAL_ADMIN'],
  'patient:register': ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  // Mirror of apps/api/src/common/permissions.ts. Excludes PHARMACIST, LAB_STAFF,
  // ACCOUNTANT by design; SUPER_ADMIN bypasses via can().
  'patient:read': ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'patient:edit': ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'patient:document': ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'complaint:record': ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'vitals:record': ['NURSE', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'diagnosis:record': ['DOCTOR', 'HOSPITAL_ADMIN'],
  'prescription:write': ['DOCTOR', 'HOSPITAL_ADMIN'],
  'prescription:dispense': ['PHARMACIST', 'HOSPITAL_ADMIN'],
  'pharmacy:manage': ['PHARMACIST', 'HOSPITAL_ADMIN'],
  'note:write': ['DOCTOR', 'HOSPITAL_ADMIN'],
  'order:create': ['DOCTOR', 'HOSPITAL_ADMIN'],
  'order:result': ['LAB_STAFF', 'DOCTOR', 'HOSPITAL_ADMIN'],
  'invoice:pay': ['RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN'],
  'billing:manage': ['RECEPTIONIST', 'ACCOUNTANT', 'HOSPITAL_ADMIN'],
  'staff:manage': ['HOSPITAL_ADMIN'],
  'admin:settings': ['HOSPITAL_ADMIN'],
  'reports:view': ['HOSPITAL_ADMIN', 'ACCOUNTANT'],
  'claims:manage': ['HOSPITAL_ADMIN', 'ACCOUNTANT'],
}

export function can(role: string | null | undefined, action: Action): boolean {
  if (!role) return false
  if (role === 'SUPER_ADMIN') return true
  return (MATRIX[action] ?? []).includes(role)
}

export const STATUS_ACTION: Record<string, Action> = {
  CHECKED_IN: 'appointment:check-in',
  IN_PROGRESS: 'appointment:start',
  COMPLETED: 'appointment:complete',
  CANCELLED: 'appointment:cancel',
  NO_SHOW: 'appointment:no-show',
  SCHEDULED: 'appointment:reopen',
}
