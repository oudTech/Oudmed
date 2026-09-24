import { STATUS_DOT, STATUS_LABEL } from '@/lib/platform'

export function StatusDonut({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, v]) => v > 0)
  const total = entries.reduce((sum, [, v]) => sum + v, 0)

  if (total === 0) {
    return <p className="text-sm text-gray-400">No hospitals yet.</p>
  }

  let acc = 0
  const stops = entries.map(([status, v]) => {
    const start = (acc / total) * 100
    acc += v
    const end = (acc / total) * 100
    return `${STATUS_DOT[status] ?? '#9CA3AF'} ${start}% ${end}%`
  })

  return (
    <div className="flex items-center gap-5">
      <div
        className="w-28 h-28 rounded-full flex-shrink-0 flex items-center justify-center"
        style={{ background: `conic-gradient(${stops.join(',')})` }}
      >
        <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center text-sm font-bold text-gray-900 tabular-nums">
          {total}
        </div>
      </div>
      <div className="space-y-1.5 text-sm">
        {entries.map(([status, v]) => (
          <div key={status} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_DOT[status] ?? '#9CA3AF' }} />
            <span className="text-gray-600">{STATUS_LABEL[status] ?? status}</span>
            <span className="text-gray-400 tabular-nums">({v})</span>
          </div>
        ))}
      </div>
    </div>
  )
}
