'use client'
import { useQuery } from '@tanstack/react-query'
import { Select } from '@/components/ui/kit'
import { adminApi } from '@/lib/admin'

/** Plain select over the active insurance-provider registry (claims need the real id). */
export function ProviderSelect({
  value,
  onChange,
  includeAll,
  className,
}: {
  value: string
  onChange: (id: string) => void
  includeAll?: boolean
  className?: string
}) {
  const providers = useQuery({
    queryKey: ['provider-options', 'all'],
    queryFn: () => adminApi.providers.options(),
  })

  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {includeAll && <option value="">All providers</option>}
      {!includeAll && <option value="">Select a provider</option>}
      {(providers.data ?? []).map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </Select>
  )
}
