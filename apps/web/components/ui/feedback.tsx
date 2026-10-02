'use client'
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Modal } from './kit'
import { errorMessage } from '@/lib/errors'

/* ─────────────────────────── toasts ─────────────────────────── */

type Tone = 'info' | 'success' | 'error' | 'loading'
type Toast = { id: number; message: string; tone: Tone; action?: { label: string; onClick: () => void } }
type ConfirmOpts = { title?: string; body?: string; confirmLabel?: string; danger?: boolean }

type PromiseMessages<T> = {
  loading: string
  success: string | ((value: T) => string)
  /** Defaults to `errorMessage(e)` - pass a string or function only to override that. */
  error?: string | ((e: unknown) => string)
  /** Shown as a button on the error toast; lets a timed-out action be retried
   * without re-finding the control that triggered it. */
  onRetry?: () => void
}

const FeedbackCtx = createContext<{
  toast: (message: string, tone?: Exclude<Tone, 'loading'>) => void
  /** For an action slow enough to need its own progress indicator beyond a
   * button spinner (a CSV export, a multi-record import, claim generation):
   * shows a loading toast immediately, upgrades it in place to success/error
   * once `promise` settles - never a second, separate toast. */
  toastPromise: <T>(promise: Promise<T>, messages: PromiseMessages<T>) => Promise<T>
  confirm: (opts?: ConfirmOpts) => Promise<boolean>
} | null>(null)

export function useToast() {
  const ctx = useContext(FeedbackCtx)
  if (!ctx) throw new Error('useToast must be used within <FeedbackProvider>')
  return ctx.toast
}

/** For the handful of actions slow enough to need a progress toast rather
 * than just a button spinner - see `toastPromise` above. */
export function useToastPromise() {
  const ctx = useContext(FeedbackCtx)
  if (!ctx) throw new Error('useToastPromise must be used within <FeedbackProvider>')
  return ctx.toastPromise
}

export function useConfirm() {
  const ctx = useContext(FeedbackCtx)
  if (!ctx) throw new Error('useConfirm must be used within <FeedbackProvider>')
  return ctx.confirm
}

const TONE_STYLE: Record<Tone, { bg: string; fg: string }> = {
  info: { bg: '#111827', fg: '#fff' },
  success: { bg: '#0DA76C', fg: '#fff' },
  error: { bg: '#DC2626', fg: '#fff' },
  loading: { bg: '#111827', fg: '#fff' },
}

// Error stays up noticeably longer (or until dismissed) since it's the one
// tone someone needs time to actually read and act on; success/info are
// momentary confirmations.
const DISMISS_MS: Record<Exclude<Tone, 'loading'>, number> = {
  info: 3500,
  success: 3500,
  error: 8000,
}
const STILL_WORKING_AFTER_MS = 4500

function ToneIcon({ tone }: { tone: Tone }) {
  if (tone === 'loading') {
    return (
      <svg className="animate-spin shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    )
  }
  if (tone === 'success') {
    return (
      <svg className="shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (tone === 'error') {
    return (
      <svg className="shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7v6M12 16.5v.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg className="shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 10.5v6M12 7v.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pending, setPending] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const clearTimer = (id: number) => {
    const t = timers.current.get(id)
    if (t) { clearTimeout(t); timers.current.delete(id) }
  }

  const dismiss = useCallback((id: number) => {
    clearTimer(id)
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const scheduleDismiss = useCallback((id: number, tone: Exclude<Tone, 'loading'>) => {
    clearTimer(id)
    timers.current.set(id, setTimeout(() => dismiss(id), DISMISS_MS[tone]))
  }, [dismiss])

  const toast = useCallback((message: string, tone: Exclude<Tone, 'loading'> = 'info') => {
    const id = nextId.current++
    setToasts((t) => [{ id, message, tone }, ...t])
    scheduleDismiss(id, tone)
  }, [scheduleDismiss])

  const toastPromise = useCallback(<T,>(promise: Promise<T>, messages: PromiseMessages<T>): Promise<T> => {
    const id = nextId.current++
    setToasts((t) => [{ id, message: messages.loading, tone: 'loading' }, ...t])

    const stillWorking = setTimeout(() => {
      setToasts((t) => t.map((x) => (x.id === id ? { ...x, message: `${messages.loading} - still working, this is taking longer than usual...` } : x)))
    }, STILL_WORKING_AFTER_MS)

    return promise.then(
      (value) => {
        clearTimeout(stillWorking)
        const text = typeof messages.success === 'function' ? messages.success(value) : messages.success
        setToasts((t) => t.map((x) => (x.id === id ? { id, message: text, tone: 'success' } : x)))
        scheduleDismiss(id, 'success')
        return value
      },
      (e) => {
        clearTimeout(stillWorking)
        const text = typeof messages.error === 'function' ? messages.error(e) : messages.error ?? errorMessage(e)
        setToasts((t) => t.map((x) => (x.id === id ? { id, message: text, tone: 'error', action: messages.onRetry ? { label: 'Retry', onClick: messages.onRetry } : undefined } : x)))
        scheduleDismiss(id, 'error')
        throw e
      },
    )
  }, [scheduleDismiss])

  const confirm = useCallback(
    (opts: ConfirmOpts = {}) =>
      new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    [],
  )

  const close = (v: boolean) => {
    pending?.resolve(v)
    setPending(null)
  }

  return (
    <FeedbackCtx.Provider value={{ toast, toastPromise, confirm }}>
      {children}

      {typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed top-4 right-4 z-[1310] flex flex-col gap-2 w-full max-w-sm px-4 sm:px-0">
            {toasts.map((t) => {
              const style = TONE_STYLE[t.tone]
              return (
                <div
                  key={t.id}
                  role={t.tone === 'error' ? 'alert' : 'status'}
                  className="flex items-start gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg"
                  style={{ backgroundColor: style.bg, color: style.fg }}
                >
                  <span className="mt-0.5"><ToneIcon tone={t.tone} /></span>
                  <span className="flex-1">{t.message}</span>
                  {t.action && (
                    <button
                      onClick={() => { t.action!.onClick(); dismiss(t.id) }}
                      className="shrink-0 underline underline-offset-2 hover:no-underline"
                    >
                      {t.action.label}
                    </button>
                  )}
                  {t.tone !== 'loading' && (
                    <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="shrink-0 opacity-70 hover:opacity-100">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    </button>
                  )}
                </div>
              )
            })}
          </div>,
          document.body,
        )}

      <Modal open={!!pending} onClose={() => close(false)} title={pending?.title ?? 'Please confirm'} width={420} align="center">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{pending?.body ?? 'Are you sure?'}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => close(false)}>Cancel</Button>
            <Button variant={pending?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {pending?.confirmLabel ?? 'Confirm'}
            </Button>
          </div>
        </div>
      </Modal>
    </FeedbackCtx.Provider>
  )
}
