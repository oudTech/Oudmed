'use client'
import { forwardRef, useId, useState } from 'react'

const inputBase =
  'w-full border rounded-lg px-4 py-2.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent placeholder:text-gray-400'

function borderClass(error?: string) {
  return error ? 'border-red-300 bg-red-50/40' : 'border-gray-200'
}

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
  required?: boolean
}

export const TextField = forwardRef<HTMLInputElement, FieldProps>(function TextField(
  { label, error, hint, required, className, id, ...props },
  ref,
) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <div>
      <label htmlFor={fieldId} className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        ref={ref}
        id={fieldId}
        aria-invalid={!!error}
        className={`${inputBase} ${borderClass(error)} ${className ?? ''}`}
        {...props}
      />
      {error ? (
        <p className="text-xs text-red-500 mt-1">{error}</p>
      ) : hint ? (
        <p className="text-xs text-gray-400 mt-1">{hint}</p>
      ) : null}
    </div>
  )
})

export function SelectField({
  label,
  error,
  required,
  children,
  className,
  id,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string
  error?: string
  required?: boolean
}) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <div>
      <label htmlFor={fieldId} className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <select
        id={fieldId}
        aria-invalid={!!error}
        className={`${inputBase} ${borderClass(error)} bg-white ${className ?? ''}`}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

export function passwordScore(pw: string): number {
  let score = 0
  if (pw.length >= 8) score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  return score
}

export function PasswordField({
  label,
  error,
  required,
  showMeter,
  value,
  id,
  ...props
}: Omit<FieldProps, 'type'> & { showMeter?: boolean }) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const [visible, setVisible] = useState(false)
  const pw = typeof value === 'string' ? value : ''
  const score = passwordScore(pw)
  const meterLabel = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'][score]
  const meterColor = ['bg-red-400', 'bg-red-400', 'bg-yellow-400', 'bg-blue-400', 'bg-green-500'][score]

  return (
    <div>
      <label htmlFor={fieldId} className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="relative">
        <input
          id={fieldId}
          type={visible ? 'text' : 'password'}
          value={value}
          aria-invalid={!!error}
          className={`${inputBase} ${borderClass(error)} pr-11`}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          tabIndex={-1}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff /> : <Eye />}
        </button>
      </div>
      {showMeter && pw.length > 0 && (
        <div className="mt-2">
          <div className="flex gap-1 mb-1">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full ${score >= i ? meterColor : 'bg-gray-200'}`}
              />
            ))}
          </div>
          <p className="text-xs text-gray-400">{meterLabel}</p>
        </div>
      )}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

function Eye() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
function EyeOff() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.12 9.12 0 0 0 5.39-1.61M1 1l22 22" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function FormError({ children }: { children: React.ReactNode }) {
  if (!children) return null
  return (
    <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2" role="alert">
      {children}
    </p>
  )
}

export function SubmitButton({
  loading,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className="w-full bg-primary text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-[#2b58c9] transition disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {loading ? 'Please wait…' : children}
    </button>
  )
}
