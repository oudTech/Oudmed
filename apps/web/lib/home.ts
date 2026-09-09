import { api } from './api'
import type { HomeResponseDTO, HomeTone } from '@oudhealth/contracts'

export const homeApi = {
  get: () => api.get<HomeResponseDTO>('/home').then((r) => r.data),
}

export const TONE: Record<HomeTone, { color: string; bg: string }> = {
  default: { color: '#111827', bg: '#F3F4F6' },
  good: { color: '#047857', bg: '#EAF7F0' },
  warn: { color: '#B45309', bg: '#FFF6E5' },
  bad: { color: '#B42318', bg: '#FEECEB' },
}

/** Maps a widget key to the screen its "view all" should open. */
export const WIDGET_HREF: Record<string, string> = {
  schedule: '/schedule',
  checkin: '/schedule',
  'appt-split': '/schedule',
  results: '/lab',
  queue: '/pharmacy',
  'pharm-stat': '/pharmacy',
  incomplete: '/patients',
  money: '/billing',
  claims: '/claims',
  census: '/reports',
}
