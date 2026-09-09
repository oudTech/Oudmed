'use client'

/** "Step 3 of 8" + a dot row. Compact, sits in the popover footer. */
export function TourProgress({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-gray-400">
        Step {step + 1} of {total}
      </span>
      <div className="flex items-center gap-1" aria-hidden>
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all ${
              i === step
                ? 'w-4 bg-primary'
                : i < step
                  ? 'w-1.5 bg-primary/50'
                  : 'w-1.5 bg-gray-200'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

/** Section overview for the Help Center (Getting around ✓ / Core workflow 2/4). */
export function SectionProgress({
  sections,
}: {
  sections: { label: string; done: boolean; current?: number; total?: number }[]
}) {
  return (
    <ul className="space-y-1.5">
      {sections.map((s) => (
        <li key={s.label} className="flex items-center justify-between text-sm">
          <span className={s.done ? 'text-gray-900' : 'text-gray-500'}>{s.label}</span>
          <span className="text-xs font-medium text-gray-400">
            {s.done ? (
              <span className="text-[#0DA76C]">Done</span>
            ) : s.current != null && s.total != null ? (
              `${s.current}/${s.total}`
            ) : (
              'Not started'
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
