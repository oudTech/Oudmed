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
    if (status === 401 && typeof window !== 'undefined' && !signingOut) {
      signingOut = true
      setAuthToken(undefined)
      signOut({ redirect: false }).finally(() => {
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login?reason=expired'
        }
      })
    }
    return Promise.reject(error)
  },
)
