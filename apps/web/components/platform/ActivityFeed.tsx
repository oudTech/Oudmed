import type { PlatformActivityItemDTO } from '@oudhealth/contracts'

export function ActivityFeed({ items, loading }: { items: PlatformActivityItemDTO[]; loading?: boolean }) {
  if (loading) return <p className="text-sm text-gray-400">Loading…</p>
  if (items.length === 0) return <p className="text-sm text-gray-400">No activity yet.</p>

  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-3 text-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-gray-700">{item.message}</p>
            <p className="text-xs text-gray-400">{new Date(item.createdAt).toLocaleString()}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
