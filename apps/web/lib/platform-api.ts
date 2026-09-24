import axios from 'axios'
import { signOut } from 'next-auth/react'

/**
 * A fully separate axios instance from lib/api.ts's `api` - a platform-operator
 * bearer token must never be attached to a hospital-scoped request or vice
 * versa. See lib/auth.ts's `platform` Credentials provider.
 */
export const platformApi = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api',
})

export function setPlatformAuthToken(token: string | undefined) {
  if (token) {
    platformApi.defaults.headers.common['Authorization'] = `Bearer ${token}`
  } else {
    delete platformApi.defaults.headers.common['Authorization']
  }
}

let signingOut = false
platformApi.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status
    if (status === 401 && typeof window !== 'undefined' && !signingOut) {
      signingOut = true
      setPlatformAuthToken(undefined)
      signOut({ redirect: false }).finally(() => {
        if (!window.location.pathname.startsWith('/platform/login')) {
          window.location.href = '/platform/login?reason=expired'
        }
      })
    }
    return Promise.reject(error)
  },
)
