import { api } from './api'
import type {
  VisitDTO,
  VisitStatus,
  StaffDTO,
  DoctorShiftDTO,
  DepartmentDTO,
  PatientDTO,
  PatientListItemDTO,
  AdmissionDTO,
  WardDTO,
  BedDTO,
  WardBoardDTO,
} from '@oudhealth/contracts'

// ── reads ──
export const getSchedule = (params: {
  from: string
  to: string
  doctorId?: string
  departmentId?: string
}) => api.get<VisitDTO[]>('/schedule', { params }).then((r) => r.data)

export const getVisit = (id: string) => api.get<VisitDTO>(`/schedule/${id}`).then((r) => r.data)

export const getDoctors = () =>
  api.get<StaffDTO[]>('/directory/staff', { params: { role: 'DOCTOR' } }).then((r) => r.data)

export const getDepartments = () =>
  api.get<DepartmentDTO[]>('/directory/departments').then((r) => r.data)

export const getWards = () => api.get<WardDTO[]>('/directory/wards').then((r) => r.data)

export const getBeds = (wardId: string, status?: string) =>
  api.get<BedDTO[]>('/directory/beds', { params: { wardId, status } }).then((r) => r.data)

export const searchPatients = (search: string) =>
  api
    .get<{ patients: PatientListItemDTO[] }>('/patients', { params: { search } })
    .then((r) => r.data.patients)

export const getAdmissions = (status?: string) =>
  api.get<AdmissionDTO[]>('/admissions', { params: { status } }).then((r) => r.data)

export const getWardBoard = () => api.get<WardBoardDTO[]>('/wards').then((r) => r.data)

export const getDoctorShifts = (doctorId: string) =>
  api.get<(DoctorShiftDTO & { id: string })[]>(`/directory/staff/${doctorId}/shifts`).then((r) => r.data)

export const setDoctorShifts = (doctorId: string, shifts: DoctorShiftDTO[]) =>
  api.put(`/directory/staff/${doctorId}/shifts`, { shifts }).then((r) => r.data)

// ── writes ──
export interface NewPatientInput {
  firstName: string
  lastName: string
  phone?: string
  gender?: string
  dateOfBirth?: string
  payerType?: string
  hmoName?: string
  hmoNumber?: string
}
export const createPatient = (data: NewPatientInput) =>
  api.post<PatientDTO>('/patients', data).then((r) => r.data as unknown as PatientPickerValue)

/** Minimal patient shape the schedule/admission pickers need. */
export type PatientPickerValue = {
  id: string
  firstName: string
  lastName: string
  patientNumber: string
  phone: string | null
  payerType: string
  hmoName: string | null
}

export interface BookVisitInput {
  patientId: string
  doctorId?: string
  departmentId?: string
  startsAt: string
  durationMinutes?: number
  visitType?: string
  reason?: string
  payerType?: string
  hmoName?: string
  authCode?: string
  force?: boolean
}
export const bookVisit = (data: BookVisitInput) =>
  api.post<VisitDTO>('/schedule', data).then((r) => r.data)

export const setVisitStatus = (id: string, status: VisitStatus, reason?: string) =>
  api.post<VisitDTO>(`/schedule/${id}/status`, { status, reason }).then((r) => r.data)

export const rescheduleVisit = (
  id: string,
  data: { startsAt: string; durationMinutes?: number; doctorId?: string; force?: boolean },
) => api.post<VisitDTO>(`/schedule/${id}/reschedule`, data).then((r) => r.data)

export const updateVisit = (id: string, data: Record<string, unknown>) =>
  api.patch<VisitDTO>(`/schedule/${id}`, data).then((r) => r.data)

export interface AdmitInput {
  patientId: string
  admittingDoctorId?: string
  attendingDoctorId?: string
  departmentId?: string
  wardId: string
  bedId: string
  admissionType: string
  reason?: string
  provisionalDiagnosis?: string
  payerType?: string
  hmoName?: string
  authCode?: string
  expectedDischargeAt?: string
}
export const admitPatient = (data: AdmitInput) =>
  api.post<AdmissionDTO>('/admissions', data).then((r) => r.data)

export const dischargeAdmission = (id: string, data: { status?: string; dischargeNotes?: string }) =>
  api.post<AdmissionDTO>(`/admissions/${id}/discharge`, data).then((r) => r.data)

export const transferAdmission = (id: string, bedId: string, reason?: string) =>
  api.post<AdmissionDTO>(`/admissions/${id}/transfer`, { bedId, reason }).then((r) => r.data)

// ── ward / bed management ──
export const createWard = (data: { name: string; wardType: string; bedCount?: number }) =>
  api.post<WardBoardDTO[]>('/wards', data).then((r) => r.data)

export const addBeds = (wardId: string, data: { count?: number; labels?: string[] }) =>
  api.post<WardBoardDTO[]>(`/wards/${wardId}/beds`, data).then((r) => r.data)

export const updateBed = (wardId: string, bedId: string, data: { label?: string; status?: string }) =>
  api.patch<WardBoardDTO[]>(`/wards/${wardId}/beds/${bedId}`, data).then((r) => r.data)

// ── status metadata (colour = status, industry standard) ──
export const VISIT_STATUS_META: Record<
  VisitStatus,
  { label: string; bg: string; border: string; dot: string; text: string }
> = {
  SCHEDULED: { label: 'Scheduled', bg: '#E4EFFF', border: '#3366E3', dot: '#3366E3', text: '#1E40AF' },
  CHECKED_IN: { label: 'Checked in', bg: '#FFF6E5', border: '#F59E0B', dot: '#F59E0B', text: '#B45309' },
  IN_PROGRESS: { label: 'In progress', bg: '#EEF0FF', border: '#6366F1', dot: '#6366F1', text: '#4338CA' },
  COMPLETED: { label: 'Completed', bg: '#EAF7F0', border: '#0DA76C', dot: '#0DA76C', text: '#047857' },
  CANCELLED: { label: 'Cancelled', bg: '#F3F4F6', border: '#9CA3AF', dot: '#9CA3AF', text: '#6B7280' },
  NO_SHOW: { label: 'No-show', bg: '#FCEBF1', border: '#FF2347', dot: '#FF2347', text: '#BE123C' },
}

/** Actions offered from a card, given its current status. */
export function nextActions(status: VisitStatus): { status: VisitStatus; label: string }[] {
  switch (status) {
    case 'SCHEDULED':
      return [
        { status: 'CHECKED_IN', label: 'Check in' },
        { status: 'NO_SHOW', label: 'Mark no-show' },
        { status: 'CANCELLED', label: 'Cancel' },
      ]
    case 'CHECKED_IN':
      return [
        { status: 'IN_PROGRESS', label: 'Start consultation' },
        { status: 'CANCELLED', label: 'Cancel' },
      ]
    case 'IN_PROGRESS':
      return [{ status: 'COMPLETED', label: 'Complete' }]
    case 'CANCELLED':
    case 'NO_SHOW':
      return [{ status: 'SCHEDULED', label: 'Reopen' }]
    default:
      return []
  }
}

export const VISIT_TYPE_LABEL: Record<string, string> = {
  CONSULTATION: 'New consultation',
  FOLLOW_UP: 'Follow-up',
  WALK_IN: 'Walk-in',
  EMERGENCY: 'Emergency',
}

/**
 * Whether a doctor is working during [startMin, endMin) (minutes from midnight)
 * on the given weekday. With no shift template at all, every slot is open.
 */
export function isWorking(
  shifts: DoctorShiftDTO[],
  dayOfWeek: number,
  startMin: number,
  endMin: number,
): boolean {
  if (!shifts || shifts.length === 0) return true
  return shifts.some(
    (s) => s.dayOfWeek === dayOfWeek && s.startMinute <= startMin && s.endMinute >= endMin,
  )
}

export function formatShifts(shifts: DoctorShiftDTO[]): string {
  if (!shifts.length) return 'No hours set'
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  return shifts
    .map((s) => `${days[s.dayOfWeek]} ${hhmm(s.startMinute)}-${hhmm(s.endMinute)}`)
    .join(', ')
}
