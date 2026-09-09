'use client'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { VisitDTO } from '@oudhealth/contracts'
import { getSchedule, getDoctors, getAdmissions, VISIT_STATUS_META, isWorking } from '@/lib/hospital'
import { can } from '@/lib/permissions'
import { startOfDay, endOfDay, addDays, dateLabel, timeLabel } from '@/lib/datetime'
import type { DoctorShiftDTO } from '@oudhealth/contracts'
import { NewAppointmentModal } from '@/components/schedule/NewAppointmentModal'
import { NewAdmissionModal } from '@/components/schedule/NewAdmissionModal'
import { ChooseActionModal } from '@/components/schedule/ChooseActionModal'
import { AppointmentDrawer } from '@/components/schedule/AppointmentDrawer'
import { DoctorHoursModal } from '@/components/schedule/DoctorHoursModal'
import { EmptyState } from '@/components/onboarding'

type View = 'today' | 'week' | 'month'

const DAY_START_HOUR = 7
const DAY_END_HOUR = 19
const SLOT_MIN = 30
const ROW_H = 56
const SLOTS = ((DAY_END_HOUR - DAY_START_HOUR) * 60) / SLOT_MIN

function slotIndex(d: Date) {
  return (d.getHours() - DAY_START_HOUR) * (60 / SLOT_MIN) + (d.getMinutes() >= 30 ? 1 : 0)
}
function spanSlots(a: Date, b: Date) {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 60000 / SLOT_MIN))
}
function slotLabel(i: number) {
  const total = DAY_START_HOUR * 60 + i * SLOT_MIN
  const h = Math.floor(total / 60)
  const m = total % 60
  const ampm = h < 12 ? 'am' : 'pm'
  const hh = h % 12 === 0 ? 12 : h % 12
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`
}

export default function SchedulePage() {
  const { data: session } = useSession()
  const primary = session?.tenant?.primaryColor ?? '#3366E3'
  const canBook = can(session?.role, 'appointment:book')
  const allowed = can(session?.role, 'patient:read')

  const [view, setView] = useState<View>('today')
  const [anchor, setAnchor] = useState(() => new Date())

  const [choose, setChoose] = useState(false)
  const [apptModal, setApptModal] = useState<{ doctorId?: string; startsAt?: Date } | null>(null)
  const [admModal, setAdmModal] = useState(false)
  const [drawerVisit, setDrawerVisit] = useState<VisitDTO | null>(null)
  const [hoursDoctor, setHoursDoctor] = useState<{ id: string; name: string } | null>(null)
  const canSetHours = can(session?.role, 'doctor:set-hours')

  const range = useMemo(() => {
    if (view === 'week') {
      const dow = (anchor.getDay() + 6) % 7
      const mon = addDays(anchor, -dow)
      return { from: startOfDay(mon), to: endOfDay(addDays(mon, 6)) }
    }
    if (view === 'month') {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
      const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
      return { from: startOfDay(first), to: endOfDay(last) }
    }
    return { from: startOfDay(anchor), to: endOfDay(anchor) }
  }, [view, anchor])

  const doctors = useQuery({ queryKey: ['doctors'], queryFn: getDoctors, enabled: allowed })
  const visits = useQuery({
    queryKey: ['schedule', range.from.toISOString(), range.to.toISOString()],
    queryFn: () => getSchedule({ from: range.from.toISOString(), to: range.to.toISOString() }),
    enabled: allowed,
  })
  const admissions = useQuery({
    queryKey: ['admissions', 'ADMITTED'],
    queryFn: () => getAdmissions('ADMITTED'),
    enabled: allowed,
  })

  const list = visits.data ?? []
  const move = (n: number) =>
    setAnchor((d) => addDays(d, view === 'week' ? n * 7 : view === 'month' ? 0 : n))
  const moveMonth = (n: number) =>
    setAnchor((d) => new Date(d.getFullYear(), d.getMonth() + n, 1))

  if (!allowed) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Appointment</h1>
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6">
          The schedule is available to clinical and front-desk staff.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="px-8 pt-7 pb-4 flex items-center justify-between flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-900">Appointment</h1>
        {canBook && (
          <button
            onClick={() => setChoose(true)}
            data-tour="schedule-new"
            className="flex items-center gap-2 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:opacity-90"
            style={{ backgroundColor: primary }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New
          </button>
        )}
      </div>

      <div className="border-b border-[#D6DEE8] flex-shrink-0" />
      <div className="px-8 flex gap-6 flex-shrink-0 border-b border-[#D6DEE8]">
        {(['today', 'week', 'month'] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`py-3 text-sm font-medium transition-colors ${view === v ? 'border-b-2' : 'text-gray-400 hover:text-gray-600'}`}
            style={view === v ? { color: primary, borderColor: primary } : undefined}
          >
            {v === 'today' ? 'Today' : v === 'week' ? 'This week' : 'This Month'}
          </button>
        ))}
      </div>

      <div className="px-8 py-4 flex items-center gap-3 flex-shrink-0 border-b border-[#D6DEE8]">
        <button
          onClick={() => (view === 'month' ? moveMonth(-1) : move(-1))}
          className="w-7 h-7 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-500"
        >
          ‹
        </button>
        <button
          onClick={() => (view === 'month' ? moveMonth(1) : move(1))}
          className="w-7 h-7 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-500"
        >
          ›
        </button>
        <span className="text-sm text-gray-700 font-medium ml-1">
          {view === 'month'
            ? anchor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
            : dateLabel(anchor)}
        </span>
        <button
          onClick={() => setAnchor(new Date())}
          className="border border-gray-200 rounded-lg px-2.5 py-1 text-sm text-gray-600 hover:bg-gray-50"
        >
          Today
        </button>
        <div className="flex-1" />
        <span className="text-sm text-gray-500">
          {admissions.data?.length ?? 0} inpatient{(admissions.data?.length ?? 0) === 1 ? '' : 's'}
        </span>
        <span className="text-sm font-semibold text-gray-800">
          {list.length} appointment{list.length === 1 ? '' : 's'}
        </span>
      </div>

      <div data-tour="schedule-board" className="flex-1 flex flex-col overflow-hidden">
        {visits.isLoading ? (
          <p className="p-8 text-sm text-gray-400">Loading…</p>
        ) : view === 'today' && list.length === 0 ? (
          <EmptyState
            title="No appointments today"
            description={
              canBook
                ? 'The day is clear. Use New to book a patient in, or open the week view to plan ahead.'
                : 'The day is clear. Appointments booked by the front desk will appear here.'
            }
            actionLabel={canBook ? 'New appointment' : undefined}
            onAction={canBook ? () => setChoose(true) : undefined}
          />
        ) : view === 'today' ? (
          <DayGrid
            day={anchor}
            columns={(doctors.data ?? []).map((d) => ({
              id: d.id,
              title: d.fullName,
              subtitle: d.jobTitle,
              shifts: d.shifts,
            }))}
            visits={list}
            canBook={canBook}
            onEmpty={(colId, start) => setApptModal({ doctorId: colId, startsAt: start })}
            onCard={setDrawerVisit}
            onDoctor={canSetHours ? (id, name) => setHoursDoctor({ id, name }) : undefined}
          />
        ) : view === 'week' ? (
          <WeekGrid
            from={range.from}
            visits={list}
            canBook={canBook}
            onEmpty={(start) => setApptModal({ startsAt: start })}
            onCard={setDrawerVisit}
          />
        ) : (
          <MonthGrid anchor={anchor} visits={list} onCard={setDrawerVisit} />
        )}
      </div>

      <ChooseActionModal
        open={choose}
        onClose={() => setChoose(false)}
        onAppointment={() => {
          setChoose(false)
          setApptModal({})
        }}
        onAdmission={() => {
          setChoose(false)
          setAdmModal(true)
        }}
      />
      <NewAppointmentModal
        open={apptModal !== null}
        onClose={() => setApptModal(null)}
        prefill={apptModal ?? undefined}
      />
      <NewAdmissionModal open={admModal} onClose={() => setAdmModal(false)} />
      <AppointmentDrawer
        visit={drawerVisit}
        onClose={() => setDrawerVisit(null)}
        onAdmit={() => {
          setDrawerVisit(null)
          setAdmModal(true)
        }}
      />
      <DoctorHoursModal doctor={hoursDoctor} onClose={() => setHoursDoctor(null)} />
    </div>
  )
}

/* ── Day grid: columns = doctors, rows = 30-min slots ── */
type DayColumn = { id: string; title: string; subtitle?: string | null; shifts?: DoctorShiftDTO[] }

function DayGrid({
  day,
  columns,
  visits,
  canBook,
  onEmpty,
  onCard,
  onDoctor,
}: {
  day: Date
  columns: DayColumn[]
  visits: VisitDTO[]
  canBook: boolean
  onEmpty: (colId: string, start: Date) => void
  onCard: (v: VisitDTO) => void
  onDoctor?: (id: string, name: string) => void
}) {
  const cols: DayColumn[] = columns.length
    ? columns
    : [{ id: '', title: 'Unassigned', subtitle: null }]
  const dow = day.getDay()

  return (
    <div className="flex-1 overflow-auto">
      <div className="min-w-[700px]">
        <div className="sticky top-0 z-10 bg-white flex border-b border-[#D6DEE8]">
          <div className="w-24 flex-shrink-0 border-r border-[#D6DEE8]" />
          {cols.map((c, i) => (
            <div
              key={c.id || i}
              className="flex-1 px-4 py-3 min-w-[160px]"
              style={{ borderRight: i < cols.length - 1 ? '1px solid #D6DEE8' : undefined }}
            >
              {onDoctor && c.id ? (
                <button
                  onClick={() => onDoctor(c.id, c.title)}
                  className="text-left group"
                  title="Edit working hours"
                >
                  <p className="text-sm font-semibold text-gray-900 truncate group-hover:text-primary">
                    {c.title}
                  </p>
                </button>
              ) : (
                <p className="text-sm font-semibold text-gray-900 truncate">{c.title}</p>
              )}
              {c.subtitle && <p className="text-xs text-gray-400">{c.subtitle}</p>}
            </div>
          ))}
        </div>

        <div className="flex">
          <div className="w-24 flex-shrink-0 border-r border-[#D6DEE8]">
            {Array.from({ length: SLOTS }).map((_, i) => (
              <div
                key={i}
                className="px-3 text-xs font-medium text-gray-500 flex items-start pt-1"
                style={{ height: ROW_H, borderBottom: '1px solid #EEF1F5' }}
              >
                {i % 2 === 0 ? slotLabel(i) : ''}
              </div>
            ))}
          </div>

          {cols.map((c, ci) => {
            const colVisits = visits.filter((v) =>
              c.id ? v.doctor?.id === c.id : !v.doctor,
            )
            return (
              <div
                key={c.id || ci}
                className="flex-1 relative min-w-[160px]"
                style={{ borderRight: ci < cols.length - 1 ? '1px solid #D6DEE8' : undefined }}
              >
                {Array.from({ length: SLOTS }).map((_, i) => {
                  const cell = new Date(day)
                  cell.setHours(DAY_START_HOUR + Math.floor(i / 2), i % 2 ? 30 : 0, 0, 0)
                  const startMin = DAY_START_HOUR * 60 + i * SLOT_MIN
                  const off =
                    c.id !== '' && !isWorking(c.shifts ?? [], dow, startMin, startMin + SLOT_MIN)
                  return (
                    <button
                      key={i}
                      onClick={() => canBook && !off && onEmpty(c.id, cell)}
                      disabled={!canBook || off}
                      title={off ? 'Outside working hours' : undefined}
                      className={`group relative w-full block transition-colors ${
                        off
                          ? 'cursor-not-allowed'
                          : canBook
                            ? 'hover:bg-blue-50/40'
                            : 'cursor-default'
                      }`}
                      style={{
                        height: ROW_H,
                        borderBottom: '1px solid #EEF1F5',
                        background: off
                          ? 'repeating-linear-gradient(45deg,#F8FAFC,#F8FAFC 6px,#F1F5F9 6px,#F1F5F9 12px)'
                          : undefined,
                      }}
                    >
                      {canBook && !off && (
                        <span className="pointer-events-none absolute inset-x-1 inset-y-0.5 flex items-center justify-center gap-1 rounded-md border border-dashed border-[#3366E3]/45 text-[11px] font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                          Add appointment
                        </span>
                      )}
                    </button>
                  )
                })}
                {colVisits.map((v) => {
                  const s = new Date(v.startsAt)
                  const idx = slotIndex(s)
                  if (idx < 0 || idx >= SLOTS) return null
                  const span = Math.min(spanSlots(s, new Date(v.endsAt)), SLOTS - idx)
                  return (
                    <div
                      key={v.id}
                      className="absolute left-1 right-1"
                      style={{ top: idx * ROW_H + 3, height: span * ROW_H - 6 }}
                    >
                      <VisitCard v={v} onClick={() => onCard(v)} />
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ── Week grid: columns = 7 days ── */
function WeekGrid({
  from,
  visits,
  canBook,
  onEmpty,
  onCard,
}: {
  from: Date
  visits: VisitDTO[]
  canBook: boolean
  onEmpty: (start: Date) => void
  onCard: (v: VisitDTO) => void
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i))
  const today = new Date().toDateString()
  return (
    <div className="flex-1 overflow-auto">
      <div className="min-w-[820px]">
        <div className="sticky top-0 z-10 bg-white flex border-b border-[#D6DEE8]">
          <div className="w-24 flex-shrink-0 border-r border-[#D6DEE8]" />
          {days.map((d, i) => (
            <div
              key={i}
              className="flex-1 py-3 flex flex-col items-center gap-1"
              style={{ borderRight: i < 6 ? '1px solid #D6DEE8' : undefined }}
            >
              <span className="text-xs font-medium uppercase text-gray-400">
                {d.toLocaleDateString('en-GB', { weekday: 'short' })}
              </span>
              <span
                className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold ${
                  d.toDateString() === today ? 'bg-primary text-white' : 'text-gray-900'
                }`}
              >
                {d.getDate()}
              </span>
            </div>
          ))}
        </div>
        <div className="flex">
          <div className="w-24 flex-shrink-0 border-r border-[#D6DEE8]">
            {Array.from({ length: SLOTS }).map((_, i) => (
              <div
                key={i}
                className="px-3 text-xs font-medium text-gray-500 pt-1"
                style={{ height: ROW_H, borderBottom: '1px solid #EEF1F5' }}
              >
                {i % 2 === 0 ? slotLabel(i) : ''}
              </div>
            ))}
          </div>
          {days.map((d, di) => {
            const dayVisits = visits.filter(
              (v) => new Date(v.startsAt).toDateString() === d.toDateString(),
            )
            return (
              <div
                key={di}
                className="flex-1 relative"
                style={{ borderRight: di < 6 ? '1px solid #D6DEE8' : undefined }}
              >
                {Array.from({ length: SLOTS }).map((_, i) => {
                  const cell = new Date(d)
                  cell.setHours(DAY_START_HOUR + Math.floor(i / 2), i % 2 ? 30 : 0, 0, 0)
                  return (
                    <button
                      key={i}
                      onClick={() => canBook && onEmpty(cell)}
                      disabled={!canBook}
                      className={`group relative w-full block ${canBook ? 'hover:bg-blue-50/40' : 'cursor-default'}`}
                      style={{ height: ROW_H, borderBottom: '1px solid #EEF1F5' }}
                    >
                      {canBook && (
                        <span className="pointer-events-none absolute inset-x-0.5 inset-y-0.5 flex items-center justify-center rounded-md border border-dashed border-[#3366E3]/45 text-primary opacity-0 transition-opacity group-hover:opacity-100">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                        </span>
                      )}
                    </button>
                  )
                })}
                {dayVisits.map((v) => {
                  const s = new Date(v.startsAt)
                  const idx = slotIndex(s)
                  if (idx < 0 || idx >= SLOTS) return null
                  const span = Math.min(spanSlots(s, new Date(v.endsAt)), SLOTS - idx)
                  return (
                    <div
                      key={v.id}
                      className="absolute left-0.5 right-0.5"
                      style={{ top: idx * ROW_H + 3, height: span * ROW_H - 6 }}
                    >
                      <VisitCard v={v} compact onClick={() => onCard(v)} />
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ── Month grid ── */
function MonthGrid({
  anchor,
  visits,
  onCard,
}: {
  anchor: Date
  visits: VisitDTO[]
  onCard: (v: VisitDTO) => void
}) {
  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  const first = new Date(year, month, 1)
  const startDow = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let i = 1; i <= daysInMonth; i++) cells.push(new Date(year, month, i))
  while (cells.length % 7) cells.push(null)
  const today = new Date().toDateString()

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="grid grid-cols-7 mb-1">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="text-center text-xs font-semibold py-2 text-gray-400">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 border-t border-l border-[#EEF1F5]">
        {cells.map((d, i) => {
          const dayVisits = d
            ? visits.filter((v) => new Date(v.startsAt).toDateString() === d.toDateString())
            : []
          return (
            <div
              key={i}
              className="p-2 border-r border-b border-[#EEF1F5]"
              style={{ minHeight: 108, background: d ? '#fff' : '#FAFAFA' }}
            >
              {d && (
                <>
                  <div
                    className={`w-6 h-6 flex items-center justify-center rounded-full mb-1 text-xs font-semibold ${
                      d.toDateString() === today ? 'bg-primary text-white' : 'text-gray-800'
                    }`}
                  >
                    {d.getDate()}
                  </div>
                  <div className="space-y-1">
                    {dayVisits.slice(0, 3).map((v) => {
                      const m = VISIT_STATUS_META[v.status]
                      return (
                        <button
                          key={v.id}
                          onClick={() => onCard(v)}
                          className="w-full text-left rounded px-1.5 py-0.5 text-xs font-medium truncate"
                          style={{ backgroundColor: m.bg, borderLeft: `2px solid ${m.border}`, color: m.text }}
                        >
                          {timeLabel(v.startsAt)} {v.patient.lastName}
                        </button>
                      )
                    })}
                    {dayVisits.length > 3 && (
                      <p className="text-[10px] text-gray-400 font-medium">+{dayVisits.length - 3} more</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Card ── */
function VisitCard({
  v,
  compact,
  onClick,
}: {
  v: VisitDTO
  compact?: boolean
  onClick: () => void
}) {
  const m = VISIT_STATUS_META[v.status]
  return (
    <button
      onClick={onClick}
      title={`${v.patient.firstName} ${v.patient.lastName} · ${timeLabel(v.startsAt)}-${timeLabel(v.endsAt)}\n${m.label}${v.reason ? `\n${v.reason}` : ''}`}
      className="w-full h-full rounded-lg p-2 text-left overflow-hidden flex flex-col"
      style={{ backgroundColor: m.bg }}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="pl-1.5 min-w-0" style={{ borderLeft: `2px solid ${m.border}` }}>
          <p className={`font-bold text-gray-900 leading-tight truncate ${compact ? 'text-[11px]' : 'text-sm'}`}>
            {v.patient.firstName} {v.patient.lastName}
          </p>
          <p className="text-[10px] text-gray-400">{timeLabel(v.startsAt)}</p>
        </div>
        {!compact && (
          <span
            className="flex items-center gap-1 bg-white px-1.5 py-0.5 rounded flex-shrink-0"
            style={{ border: '1px solid #E5E9F0' }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.dot }} />
            <span className="text-[10px] font-medium text-gray-600">{m.label}</span>
          </span>
        )}
      </div>
      {!compact && v.reason && (
        <p className="mt-auto pt-1 text-[11px] text-gray-500 line-clamp-2">{v.reason}</p>
      )}
    </button>
  )
}
