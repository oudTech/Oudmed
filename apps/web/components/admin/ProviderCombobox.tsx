'use client'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/kit'
import { adminApi } from '@/lib/admin'

/**
 * Autocomplete off the insurance-provider registry. Free text is still allowed
 * (a walk-in payer that isn't on the registry yet), so this writes a plain string.
 */
export function ProviderCombobox({
  value,
  onChange,
  kind,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  kind?: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 200)
    return () => clearTimeout(t)
  }, [value])

  const options = useQuery({
    queryKey: ['provider-options', kind ?? 'all'],
    queryFn: () => adminApi.providers.options(kind),
    enabled: open,
  })

  const q = debounced.trim().toLowerCase()
  const matches = (options.data ?? []).filter((o) => !q || o.name.toLowerCase().includes(q)).slice(0, 8)

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder ?? 'Start typing a provider name'}
      />
      {open && matches.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {matches.map((o) => (
            <button
              key={o.id}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between"
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(o.name)
                setOpen(false)
              }}
            >
              <span>{o.name}</span>
              <span className="text-xs text-gray-400">{o.kind}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
