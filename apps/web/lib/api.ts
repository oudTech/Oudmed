import axios from 'axios'
import { signOut } from 'next-auth/react'

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api',
})

export function setAuthToken(token: string | undefined) {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`
  } else {
    delete api.defaults.headers.common['Authorization']
  }
}

/** Fired whenever a write is blocked because the hospital's subscription needs attention (see SUBSCRIPTION_READ_ONLY). */
export const SUBSCRIPTION_READ_ONLY_EVENT = 'subscription-read-only'

/**
 * A 401 from the API means the session was revoked (deactivated user / tenant,
 * expired token) - the per-request JWT re-check failed. It is not transient
 * (network failures surface as no response). Clear the session and send the user
 * to /login. Guarded so a burst of concurrent 401s triggers one sign-out.
 */
let signingOut = false
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status
    const code = error?.response?.data?.code
    if (status === 401 && typeof window !== 'undefined' && !signingOut) {
      signingOut = true
      setAuthToken(undefined)
      signOut({ redirect: false }).finally(() => {
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login?reason=expired'
        }
      })
    }
    // A write blocked by the grace-period enforcement - surfaced globally
    // (rather than only wherever the specific form's own error handling shows
    // it) since it applies to every role, not just the admin who can act on it.
    if (status === 402 && code === 'SUBSCRIPTION_READ_ONLY' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(SUBSCRIPTION_READ_ONLY_EVENT))
    }
    // Platform-wide maintenance mode (Super Admin > Settings) - every hospital
    // request is rejected while it's on. A standalone page, not under
    // (protected), so it never itself triggers another blocked request.
    if (status === 503 && code === 'MAINTENANCE_MODE' && typeof window !== 'undefined') {
      if (!window.location.pathname.startsWith('/maintenance')) {
        window.location.href = '/maintenance'
      }
    }
    return Promise.reject(error)
  },
)
