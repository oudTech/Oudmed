'use client'
import { forwardRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

/* ── Modal ── */
export function Modal({
  open,
  onClose,
  title,
  children,
  width = 560,
  align = 'top',
}: {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  children: React.ReactNode
  width?: number
  /** 'top' keeps tall forms scrollable from the top; 'center' vertically centers a short modal. */
  align?: 'top' | 'center'
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      className={`fixed inset-0 z-[999] flex justify-center overflow-y-auto py-10 px-4 ${
        align === 'center' ? 'items-center' : 'items-start'
      }`}
      style={{ background: 'rgba(15,23,42,0.35)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full shadow-2xl"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 pt-5 pb-3">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 -mr-1" aria-label="Close">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/* ── Drawer (right) ── */
export function Drawer({
  open,
  onClose,
  title,
  children,
  width,
}: {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  children: React.ReactNode
  /** px cap for the panel; defaults to a narrow drawer (~28rem). */
  width?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      className="fixed inset-0 z-[999] flex justify-end"
      style={{ background: 'rgba(15,23,42,0.35)' }}
      onClick={onClose}
    >
      <div
        className={`bg-white h-full w-full shadow-2xl flex flex-col animate-[slidein_.2s_ease-out] ${
          width ? '' : 'max-w-md'
        }`}
        style={width ? { maxWidth: width } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 h-14 border-b border-gray-100 flex-shrink-0">
          <h2 className="font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Close">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

/* ── Form fields ── */
const control =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400'

export function Field({
  label,
  error,
  required,
  children,
}: {
  label?: string
  error?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

// forwardRef so react-hook-form's register() can bind these directly.
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return <input ref={ref} {...props} className={`${control} ${props.className ?? ''}`} />
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea(props, ref) {
    return <textarea ref={ref} {...props} className={`${control} ${props.className ?? ''}`} />
  },
)

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select(props, ref) {
    return <select ref={ref} {...props} className={`${control} bg-white ${props.className ?? ''}`} />
  },
)

export function Button({
  variant = 'primary',
  loading,
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  loading?: boolean
}) {
  const styles = {
    primary: 'bg-primary text-white hover:brightness-95',
    secondary: 'border border-gray-200 text-gray-700 hover:bg-gray-50',
    danger: 'bg-red-500 text-white hover:bg-red-600',
    ghost: 'text-primary hover:bg-blue-50',
  }[variant]
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${styles} ${className ?? ''}`}
    >
      {loading ? 'Please wait…' : children}
    </button>
  )
}

export function Badge({
  children,
  color = '#6B7280',
  bg = '#F3F4F6',
}: {
  children: React.ReactNode
  color?: string
  bg?: string
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ color, backgroundColor: bg }}
    >
      {children}
    </span>
  )
}
