import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * Fine-grained action permissions. The API is the authority; the web app mirrors
 * this in apps/web/lib/permissions.ts to hide/disable controls. Keep them in sync.
 */
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
  | 'claims:manage';

const R = Role;

/**
 * The single authoritative role -> action map. `apps/web/lib/permissions.ts`
 * carries an identical copy for UI hiding; `permissions.drift.spec.ts` fails the
 * build if the two ever diverge.
 */
export const MATRIX: Record<Action, Role[]> = {
  'appointment:book': [R.RECEPTIONIST, R.NURSE, R.DOCTOR, R.HOSPITAL_ADMIN],
  'appointment:reschedule': [R.RECEPTIONIST, R.NURSE, R.HOSPITAL_ADMIN],
  'appointment:edit': [R.RECEPTIONIST, R.NURSE, R.DOCTOR, R.HOSPITAL_ADMIN],
  'appointment:check-in': [R.RECEPTIONIST, R.NURSE, R.HOSPITAL_ADMIN],
  'appointment:start': [R.DOCTOR, R.NURSE, R.HOSPITAL_ADMIN],
  'appointment:complete': [R.DOCTOR, R.NURSE, R.HOSPITAL_ADMIN],
  'appointment:cancel': [R.RECEPTIONIST, R.NURSE, R.DOCTOR, R.HOSPITAL_ADMIN],
  'appointment:no-show': [R.RECEPTIONIST, R.NURSE, R.HOSPITAL_ADMIN],
  'appointment:reopen': [R.RECEPTIONIST, R.NURSE, R.HOSPITAL_ADMIN],
  'admission:create': [R.NURSE, R.DOCTOR, R.HOSPITAL_ADMIN],
  'admission:edit': [R.NURSE, R.DOCTOR, R.HOSPITAL_ADMIN],
  'admission:transfer': [R.NURSE, R.HOSPITAL_ADMIN],
  'admission:discharge': [R.DOCTOR, R.NURSE, R.HOSPITAL_ADMIN],
  'ward:manage': [R.HOSPITAL_ADMIN],
  'bed:set-status': [R.NURSE, R.HOSPITAL_ADMIN],
  'doctor:set-hours': [R.HOSPITAL_ADMIN],
  'patient:register': [R.RECEPTIONIST, R.NURSE, R.DOCTOR, R.HOSPITAL_ADMIN],
  // Reading a patient record and its clinical sub-resources (chart, documents,
  // encounter view). Deliberately excludes PHARMACIST, LAB_STAFF and ACCOUNTANT:
  // their workflows are served by dedicated queues/screens (dispensing queue, lab
  // worklist, billing) that carry only the minimal patient identifiers they need.
  // SUPER_ADMIN bypasses via can(). See apps/web/lib/permissions.ts (mirror).
  'patient:read': [R.RECEPTIONIST, R.NURSE, R.DOCTOR, R.HOSPITAL_ADMIN],
  'patient:edit': [R.RECEPTIONIST, R.NURSE, R.DOCTOR, R.HOSPITAL_ADMIN],
  'patient:document': [R.RECEPTIONIST, R.NURSE, R.DOCTOR, R.HOSPITAL_ADMIN],
  'complaint:record': [R.RECEPTIONIST, R.NURSE, R.DOCTOR, R.HOSPITAL_ADMIN],
  'vitals:record': [R.NURSE, R.DOCTOR, R.HOSPITAL_ADMIN],
  'diagnosis:record': [R.DOCTOR, R.HOSPITAL_ADMIN],
  'prescription:write': [R.DOCTOR, R.HOSPITAL_ADMIN],
  'prescription:dispense': [R.PHARMACIST, R.HOSPITAL_ADMIN],
  'pharmacy:manage': [R.PHARMACIST, R.HOSPITAL_ADMIN],
  'note:write': [R.DOCTOR, R.HOSPITAL_ADMIN],
  'order:create': [R.DOCTOR, R.HOSPITAL_ADMIN],
  'order:result': [R.LAB_STAFF, R.DOCTOR, R.HOSPITAL_ADMIN],
  'invoice:pay': [R.RECEPTIONIST, R.ACCOUNTANT, R.HOSPITAL_ADMIN],
  'billing:manage': [R.RECEPTIONIST, R.ACCOUNTANT, R.HOSPITAL_ADMIN],
  'staff:manage': [R.HOSPITAL_ADMIN],
  'admin:settings': [R.HOSPITAL_ADMIN],
  'reports:view': [R.HOSPITAL_ADMIN, R.ACCOUNTANT],
  'claims:manage': [R.HOSPITAL_ADMIN, R.ACCOUNTANT],
};

export function can(role: string | null | undefined, action: Action): boolean {
  if (!role) return false;
  if (role === R.SUPER_ADMIN) return true;
  return (MATRIX[action] ?? []).includes(role as Role);
}

export function assertCan(role: string | null | undefined, action: Action): void {
  if (!can(role, action)) {
    throw new ForbiddenException({
      statusCode: 403,
      message: 'Your role cannot perform this action',
      code: 'FORBIDDEN_ACTION',
      action,
    });
  }
}

/** Maps a target VisitStatus to the action needed to move an appointment there. */
export const STATUS_ACTION: Record<string, Action> = {
  CHECKED_IN: 'appointment:check-in',
  IN_PROGRESS: 'appointment:start',
  COMPLETED: 'appointment:complete',
  CANCELLED: 'appointment:cancel',
  NO_SHOW: 'appointment:no-show',
  SCHEDULED: 'appointment:reopen',
};
