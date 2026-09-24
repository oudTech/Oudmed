import { naira } from '@/lib/platform'

function formatMonth(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' })
}

export function RevenueChart({ data }: { data: { month: string; total: string }[] }) {
  const values = data.map((d) => Number(d.total))
  const max = Math.max(1, ...values)

  return (
    <div className="flex items-end gap-3 h-40">
      {data.map((d) => {
        const v = Number(d.total)
        const h = v > 0 ? Math.max(4, (v / max) * 100) : 2
        return (
          <div key={d.month} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
            <div className="w-full rounded-t-md bg-blue-50 relative flex-1 flex items-end" title={naira(v)}>
              <div className="w-full rounded-t-md bg-primary" style={{ height: `${h}%` }} />
            </div>
            <span className="text-[11px] text-gray-400">{formatMonth(d.month)}</span>
          </div>
        )
      })}
    </div>
  )
}
