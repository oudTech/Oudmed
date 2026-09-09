'use client'
import { useEffect, useRef, useState } from 'react'

/**
 * The ⋮ menu shared by every Administration table row: Edit / Activate·Deactivate /
 * Delete. Delete asks for confirmation inline and surfaces an IN_USE 400 from the API
 * as a "deactivate instead" hint.
 */
export function AdminRowActions({
  isActive,
  onEdit,
  onToggle,
  onDelete,
  busy,
}: {
  isActive: boolean
  onEdit: () => void
  onToggle: () => void
  onDelete: () => Promise<unknown>
  busy?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [err, setErr] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setConfirming(false)
        setErr('')
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const runDelete = async () => {
    setErr('')
    try {
      await onDelete()
      setOpen(false)
      setConfirming(false)
    } catch (e: any) {
      const code = e?.response?.data?.code
      setErr(
        code === 'IN_USE'
          ? e?.response?.data?.message ?? 'This record is in use. Deactivate it instead.'
          : e?.response?.data?.message ?? 'Could not delete this record.',
      )
    }
  }

  return (
    <div className="relative flex justify-end" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-7 h-7 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        aria-label="Row actions"
      >
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-30 w-52 rounded-lg border border-gray-200 bg-white py-1 shadow-lg text-sm">
          <button
            className="block w-full px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
            onClick={() => { setOpen(false); onEdit() }}
          >
            Edit
          </button>
          <button
            className="block w-full px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
            onClick={() => { setOpen(false); onToggle() }}
          >
            {isActive ? 'Deactivate' : 'Activate'}
          </button>
          <div className="my-1 border-t border-gray-100" />
          {!confirming ? (
            <button
              className="block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50"
              onClick={() => setConfirming(true)}
            >
              Delete
            </button>
          ) : (
            <div className="px-3 py-2">
              <p className="text-xs text-gray-600 mb-2">Delete permanently?</p>
              {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={runDelete}
                  className="rounded-md bg-red-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                >
                  Delete
                </button>
                <button
                  onClick={() => { setConfirming(false); setErr('') }}
                  className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className="text-xs font-medium rounded-full px-2 py-0.5"
      style={active ? { color: '#047857', backgroundColor: '#EAF7F0' } : { color: '#6B7280', backgroundColor: '#F3F4F6' }}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

export function Pagination({
  page,
  total,
  pageSize,
  noun,
  onPage,
}: {
  page: number
  total: number
  pageSize: number
  noun: string
  onPage: (p: number) => void
}) {
  if (total <= pageSize) return null
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex items-center justify-between mt-4 text-sm">
      <span className="text-gray-400">
        Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} {noun}
      </span>
      <div className="flex items-center gap-1">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="w-7 h-7 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50">‹</button>
        <span className="px-2 text-gray-600">{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="w-7 h-7 rounded-md border border-gray-200 disabled:opacity-40 hover:bg-gray-50">›</button>
      </div>
    </div>
  )
}
