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

function safeJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}

export interface ContactInquiryInput {
  firstName: string
  lastName: string
  email: string
  phone: string
  message: string
  turnstileToken: string
  website?: string
  formRenderedAt: number
}

export const contactApi = {
  submit: async (data: ContactInquiryInput): Promise<{ ok: true }> => {
    let res: Response
    try {
      res = await fetch(`${API}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    } catch {
      throw new ApiError('Network error. Check your connection and try again.', 0, {})
    }
    const text = await res.text()
    const body = text ? safeJson(text) : {}
    if (!res.ok) {
      const message =
        (Array.isArray(body?.message) ? body.message[0] : body?.message) || 'Something went wrong. Please try again.'
      throw new ApiError(message, res.status, body)
    }
    return body as { ok: true }
  },
}
