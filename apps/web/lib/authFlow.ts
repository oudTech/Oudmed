import { signIn } from 'next-auth/react'

export const HOME_PATH = '/dashboard'

/** Turn an API session token into a NextAuth session cookie (scoped to this host). */
export async function establishSession(token: string): Promise<boolean> {
  const res = await signIn('credentials', { token, redirect: false })
  return !res?.error
}
