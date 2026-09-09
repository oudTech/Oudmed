const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api'

export class ApiError extends Error {
  code?: string
  status: number
  body: any
  constructor(message: string, status: number, body: any) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = body?.code
    this.body = body
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init
  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    })
  } catch {
    throw new ApiError('Network error. Check your connection and try again.', 0, {})
  }
  const text = await res.text()
  const body = text ? safeJson(text) : {}
  if (!res.ok) {
    const message =
      (Array.isArray(body?.message) ? body.message[0] : body?.message) ||
      'Something went wrong. Please try again.'
    throw new ApiError(message, res.status, body)
  }
  return body as T
}

function safeJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}

export type SessionResult = {
  accessToken: string
  user: {
    id: string
    email: string
    fullName: string
    role: string
    avatarUrl: string | null
    emailVerified: boolean
  }
  tenant: { id: string; name: string; slug: string; logoUrl: string | null; primaryColor: string }
}

export type TenantPublic = {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  primaryColor: string
}

export const authApi = {
  // ── apex: new-clinic sign-up ──
  register: (data: { fullName: string; email: string; password: string; acceptedTerms: boolean }) =>
    request<{ pendingToken: string; email: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  verifyEmail: (data: { pendingToken: string; code: string }) =>
    request<{ pendingToken: string; email: string; verified: true }>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  resendVerification: (data: { pendingToken: string }) =>
    request<{ ok: true }>('/auth/resend-verification', { method: 'POST', body: JSON.stringify(data) }),

  createTenant: (
    pendingToken: string,
    data: { name: string; facilityType: string; country: string; staffSizeBand?: string },
  ) =>
    request<{ tenant: { slug: string; name: string }; redirectUrl: string }>('/tenants', {
      method: 'POST',
      token: pendingToken,
      body: JSON.stringify(data),
    }),

  // ── tenant subdomain ──
  resolveTenant: (identifier: string) =>
    request<TenantPublic>(`/tenants/resolve?identifier=${encodeURIComponent(identifier)}`),

  login: (data: { tenantSlug: string; email: string; password: string }) =>
    request<SessionResult>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  redeemTicket: (ticket: string) =>
    request<SessionResult>('/auth/redeem-ticket', {
      method: 'POST',
      body: JSON.stringify({ ticket }),
    }),

  forgotPassword: (data: { tenantSlug: string; email: string }) =>
    request<{ ok: true }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify(data) }),

  resetPassword: (data: { token: string; password: string }) =>
    request<SessionResult>('/auth/reset-password', { method: 'POST', body: JSON.stringify(data) }),
}
