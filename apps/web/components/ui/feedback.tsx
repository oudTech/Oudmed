'use client'
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Modal } from './kit'

/* ─────────────────────────── toasts ─────────────────────────── */

type Toast = { id: number; message: string; tone: 'info' | 'success' | 'error' }
type ConfirmOpts = { title?: string; body?: string; confirmLabel?: string; danger?: boolean }

const FeedbackCtx = createContext<{
  toast: (message: string, tone?: Toast['tone']) => void
  confirm: (opts?: ConfirmOpts) => Promise<boolean>
} | null>(null)

export function useToast() {
  const ctx = useContext(FeedbackCtx)
  if (!ctx) throw new Error('useToast must be used within <FeedbackProvider>')
  return ctx.toast
}

export function useConfirm() {
  const ctx = useContext(FeedbackCtx)
  if (!ctx) throw new Error('useConfirm must be used within <FeedbackProvider>')
  return ctx.confirm
}

const TONE = {
  info: 'bg-gray-900 text-white',
  success: 'bg-[#0DA76C] text-white',
  error: 'bg-red-600 text-white',
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pending, setPending] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const nextId = useRef(1)

  const toast = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = nextId.current++
    setToasts((t) => [...t, { id, message, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

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
    <FeedbackCtx.Provider value={{ toast, confirm }}>
      {children}

      {typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[1001] flex flex-col items-center gap-2">
            {toasts.map((t) => (
              <div key={t.id} className={`rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${TONE[t.tone]}`}>
                {t.message}
              </div>
            ))}
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
