/**
 * One shared way to turn a failed request into a message a person can act
 * on, replacing the ad-hoc `e?.response?.data?.message ?? 'Could not save.'`
 * repeated across the app (feedback-coverage.md L3). Distinguishes "never
 * reached the server" from "server rejected it" from "server broke" - each
 * needs a different next action from the person reading it.
 */
export function errorMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const err = e as {
    code?: string
    message?: string
    response?: { status?: number; data?: { message?: string | string[] } }
  } | null | undefined
  if (!err) return fallback

  if (!err.response) {
    if (err.code === 'ECONNABORTED') return 'That took too long to respond. Check your connection and try again.'
    return 'Could not reach the server - check your connection and try again.'
  }

  const serverMessage = err.response.data?.message
  if (typeof serverMessage === 'string' && serverMessage.trim()) return serverMessage
  if (Array.isArray(serverMessage) && serverMessage.length) return serverMessage.join(' ')

  const status = err.response.status
  if (status === 403) return "You don't have permission to do that."
  if (status === 404) return 'That could not be found - it may have been removed.'
  if (status && status >= 500) return 'The server had a problem. Please try again in a moment.'
  return fallback
}
