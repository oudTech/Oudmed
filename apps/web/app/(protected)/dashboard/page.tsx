'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { HomeWidgetDTO } from '@oudhealth/contracts'
import { homeApi, TONE, WIDGET_HREF } from '@/lib/home'
import { useOnboarding, FirstRunChecklist } from '@/components/onboarding'

export default function DashboardPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['home'],
    queryFn: homeApi.get,
    retry: false,
    refetchInterval: 120_000,
  })

  if (isLoading) return <div className="p-8 text-sm text-gray-400">Loading…</div>
  if (isError || !data)
    return <div className="p-8 text-sm text-red-500">Could not load your dashboard. Check the API is running.</div>

  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="flex flex-col h-full bg-[#F7F9FC] overflow-hidden">
      <div
        data-tour="dashboard-greeting"
        className="px-8 pt-7 pb-4 flex-shrink-0 bg-white border-b border-[#D6DEE8] flex items-start justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {greet}, {data.greetingName}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {data.hospitalName} ·{' '}
            {new Date(data.today).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <TakeTheTour />
      </div>

      <div data-tour="dashboard-widgets" className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        <FirstRunChecklist />
        {data.widgets.map((w) => (
          <Widget key={w.key} w={w} />
        ))}
      </div>
    </div>
  )
}

function TakeTheTour() {
  const { restart, state } = useOnboarding()
  const label = state.completedTours.length > 0 ? 'Replay the tour' : 'Take a quick tour'
  return (
    <button
      onClick={() => restart('getting-around')}
      className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 17v-5M12 8h.01" />
      </svg>
      {label}
    </button>
  )
}

function Widget({ w }: { w: HomeWidgetDTO }) {
  const href = w.href ?? WIDGET_HREF[w.key]

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">{w.title}</h2>
        {href && (
          <Link href={href} className="text-xs font-medium text-primary hover:underline">
            View all
          </Link>
        )}
      </div>

      {(w.kind === 'stat' || w.kind === 'split') && (
        <div className={`grid gap-4 ${w.kind === 'split' ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 lg:grid-cols-4'}`}>
          {(w.stats ?? []).map((s, i) => {
            const t = TONE[s.tone ?? 'default']
            return (
              <div key={i} className="rounded-xl border border-gray-100 bg-white p-4">
                <p className="text-sm text-gray-500">{s.label}</p>
                <p className="mt-1 text-2xl font-bold" style={{ color: t.color }}>
                  {s.value}
                </p>
                {s.hint && <p className="mt-1 text-xs text-gray-400">{s.hint}</p>}
              </div>
            )
          })}
        </div>
      )}

      {w.kind === 'list' && (
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
          {(w.items ?? []).length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">{w.empty ?? 'Nothing here.'}</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {w.items!.map((it, i) => (
                <li key={i} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{it.primary}</p>
                    {it.secondary && <p className="text-xs text-gray-500">{it.secondary}</p>}
                  </div>
                  {it.meta && (
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium capitalize"
                      style={{ color: TONE[it.tone ?? 'default'].color, backgroundColor: TONE[it.tone ?? 'default'].bg }}
                    >
                      {it.meta}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
