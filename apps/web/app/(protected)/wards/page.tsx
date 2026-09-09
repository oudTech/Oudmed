'use client'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { AdmissionDTO, BoardBedDTO, WardBoardDTO } from '@oudhealth/contracts'
import { Modal, Field, Input, Select, Button } from '@/components/ui/kit'
import { getWardBoard, getAdmissions, createWard, addBeds, updateBed } from '@/lib/hospital'
import { can } from '@/lib/permissions'
import { NewAdmissionModal } from '@/components/schedule/NewAdmissionModal'
import { AdmissionDrawer } from '@/components/schedule/AdmissionDrawer'
import { EmptyState } from '@/components/onboarding'

const BED_META: Record<string, { label: string; bg: string; border: string; text: string }> = {
  AVAILABLE: { label: 'Available', bg: '#EAF7F0', border: '#0DA76C', text: '#047857' },
  OCCUPIED: { label: 'Occupied', bg: '#E4EFFF', border: '#3366E3', text: '#1E40AF' },
  RESERVED: { label: 'Reserved', bg: '#FFF6E5', border: '#F59E0B', text: '#B45309' },
  MAINTENANCE: { label: 'Maintenance', bg: '#F3F4F6', border: '#9CA3AF', text: '#6B7280' },
}
const WARD_TYPES = ['GENERAL', 'PRIVATE', 'ICU', 'HDU', 'MATERNITY', 'PEDIATRIC', 'ISOLATION']

export default function WardsPage() {
  const { data: session } = useSession()
  const role = session?.role
  const allowed = can(role, 'patient:read')
  const qc = useQueryClient()

  const board = useQuery({ queryKey: ['wards'], queryFn: getWardBoard, enabled: allowed })
  const admissions = useQuery({
    queryKey: ['admissions', 'ADMITTED'],
    queryFn: () => getAdmissions('ADMITTED'),
    enabled: allowed,
  })
  const admissionById = useMemo(
    () => new Map((admissions.data ?? []).map((a) => [a.id, a])),
    [admissions.data],
  )

  const [admitPrefill, setAdmitPrefill] = useState<{ wardId: string; bedId: string } | null>(null)
  const [openAdmission, setOpenAdmission] = useState<AdmissionDTO | null>(null)
  const [newWard, setNewWard] = useState(false)
  const [bedMenu, setBedMenu] = useState<{ wardId: string; bed: BoardBedDTO } | null>(null)

  const totals = (board.data ?? []).reduce(
    (acc, w) => ({
      total: acc.total + w.stats.total,
      occupied: acc.occupied + w.stats.occupied,
      available: acc.available + w.stats.available,
    }),
    { total: 0, occupied: 0, available: 0 },
  )
  const occ = totals.total ? Math.round((totals.occupied / totals.total) * 100) : 0

  const setStatus = useMutation({
    mutationFn: ({ wardId, bedId, status }: { wardId: string; bedId: string; status: string }) =>
      updateBed(wardId, bedId, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wards'] })
      setBedMenu(null)
    },
  })

  if (!allowed) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Wards &amp; Beds</h1>
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6">
          The ward board is available to clinical and front-desk staff.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="px-8 pt-7 pb-4 flex items-center justify-between flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-900">Wards &amp; Beds</h1>
        {can(role, 'ward:manage') && (
          <Button onClick={() => setNewWard(true)}>Add ward</Button>
        )}
      </div>
      <div className="border-b border-[#D6DEE8] flex-shrink-0" />

      <div data-tour="wards-board" className="px-8 py-4 flex gap-3 flex-shrink-0 border-b border-[#D6DEE8]">
        <Stat label="Total beds" value={totals.total} />
        <Stat label="Occupied" value={totals.occupied} tone="#3366E3" />
        <Stat label="Available" value={totals.available} tone="#0DA76C" />
        <Stat label="Occupancy" value={`${occ}%`} tone={occ > 85 ? '#DC2626' : '#111827'} />
      </div>

      <div className="flex-1 overflow-auto p-8 space-y-6">
        {board.isLoading && <p className="text-sm text-gray-400">Loading…</p>}
        {board.data && board.data.length === 0 && (
          <EmptyState
            title="No wards set up yet"
            description={
              can(role, 'ward:manage')
                ? 'Add a ward and its beds to start admitting patients. The board then shows every bed and who is in it, live.'
                : 'Once an admin adds wards, this board shows every bed and who is in it, live.'
            }
            actionLabel={can(role, 'ward:manage') ? 'Add ward' : undefined}
            onAction={can(role, 'ward:manage') ? () => setNewWard(true) : undefined}
          />
        )}
        {board.data?.map((w) => (
          <WardSection
            key={w.id}
            ward={w}
            canManage={can(role, 'ward:manage')}
            canSetBed={can(role, 'bed:set-status')}
            onAvailableBed={(bedId) => setAdmitPrefill({ wardId: w.id, bedId })}
            onOccupiedBed={(admissionId) => {
              const a = admissionById.get(admissionId)
              if (a) setOpenAdmission(a)
            }}
            onBedMenu={(bed) => setBedMenu({ wardId: w.id, bed })}
          />
        ))}
      </div>

      {/* bed status menu */}
      <Modal
        open={!!bedMenu}
        onClose={() => setBedMenu(null)}
        title={`Bed ${bedMenu?.bed.label ?? ''}`}
        width={380}
      >
        <div className="space-y-2">
          {(['AVAILABLE', 'RESERVED', 'MAINTENANCE'] as const).map((s) => (
            <Button
              key={s}
              variant={bedMenu?.bed.status === s ? 'primary' : 'secondary'}
              className="w-full"
              loading={setStatus.isPending}
              onClick={() =>
                bedMenu && setStatus.mutate({ wardId: bedMenu.wardId, bedId: bedMenu.bed.id, status: s })
              }
            >
              {BED_META[s].label}
            </Button>
          ))}
        </div>
      </Modal>

      <NewWardModal open={newWard} onClose={() => setNewWard(false)} />
      <NewAdmissionModal
        open={!!admitPrefill}
        onClose={() => setAdmitPrefill(null)}
        prefill={admitPrefill ?? undefined}
      />
      <AdmissionDrawer admission={openAdmission} onClose={() => setOpenAdmission(null)} />
    </div>
  )
}

function WardSection({
  ward,
  canManage,
  canSetBed,
  onAvailableBed,
  onOccupiedBed,
  onBedMenu,
}: {
  ward: WardBoardDTO
  canManage: boolean
  canSetBed: boolean
  onAvailableBed: (bedId: string) => void
  onOccupiedBed: (admissionId: string) => void
  onBedMenu: (bed: BoardBedDTO) => void
}) {
  const qc = useQueryClient()
  const add = useMutation({
    mutationFn: () => addBeds(ward.id, { count: 1 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wards'] }),
  })
  return (
    <section>
      <div className="flex items-center gap-3 mb-3">
        <h2 className="font-bold text-gray-900">{ward.name}</h2>
        <span className="text-xs text-gray-400 uppercase tracking-wide">{ward.wardType}</span>
        <span className="text-xs text-gray-500">
          {ward.stats.occupied}/{ward.stats.total} occupied · {ward.stats.available} free
        </span>
        {canManage && (
          <button
            onClick={() => add.mutate()}
            className="text-xs text-[#0A89D3] hover:underline ml-auto"
          >
            + add bed
          </button>
        )}
      </div>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {ward.beds.map((b) => {
          const m = BED_META[b.status]
          const days = b.admission
            ? Math.max(1, Math.ceil((Date.now() - new Date(b.admission.admittedAt).getTime()) / 86400000))
            : 0
          return (
            <div
              key={b.id}
              className="rounded-xl p-2.5 border relative"
              style={{ backgroundColor: m.bg, borderColor: m.border + '55' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold" style={{ color: m.text }}>
                  {b.label}
                </span>
                {b.status !== 'OCCUPIED' && canSetBed && (
                  <button
                    onClick={() => onBedMenu(b)}
                    className="text-gray-400 hover:text-gray-700 -mr-1"
                    aria-label="Bed options"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
                    </svg>
                  </button>
                )}
              </div>
              {b.admission ? (
                <button onClick={() => onOccupiedBed(b.admission!.id)} className="text-left mt-1 w-full">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {b.admission.patient.firstName} {b.admission.patient.lastName}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {b.admission.admissionNumber} · day {days}
                  </p>
                </button>
              ) : b.status === 'AVAILABLE' ? (
                <button
                  onClick={() => onAvailableBed(b.id)}
                  className="mt-1 text-xs font-medium hover:underline"
                  style={{ color: m.text }}
                >
                  Admit here
                </button>
              ) : (
                <p className="mt-1 text-xs text-gray-400">{m.label}</p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function NewWardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [wardType, setWardType] = useState('GENERAL')
  const [bedCount, setBedCount] = useState(6)
  const [error, setError] = useState('')

  const key = String(open)
  const [seen, setSeen] = useState(key)
  if (key !== seen) {
    setSeen(key)
    setName('')
    setWardType('GENERAL')
    setBedCount(6)
    setError('')
  }

  const create = useMutation({
    mutationFn: () => createWard({ name: name.trim(), wardType, bedCount }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wards'] })
      onClose()
    },
    onError: (e: any) => setError(e?.response?.data?.message ?? 'Could not create the ward.'),
  })

  return (
    <Modal open={open} onClose={onClose} title="Add ward" width={440}>
      <div className="space-y-3">
        <Field label="Ward name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Surgical Ward B" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={wardType} onChange={(e) => setWardType(e.target.value)}>
              {WARD_TYPES.map((w) => (
                <option key={w} value={w}>{w[0] + w.slice(1).toLowerCase()}</option>
              ))}
            </Select>
          </Field>
          <Field label="Beds to create">
            <Input
              type="number"
              min={0}
              max={200}
              value={bedCount}
              onChange={(e) => setBedCount(Number(e.target.value))}
            />
          </Field>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={name.trim().length < 2} onClick={() => create.mutate()}>
            Create ward
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Stat({ label, value, tone = '#111827' }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex-1 border border-gray-100 rounded-xl px-4 py-2.5">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-xl font-bold" style={{ color: tone }}>
        {value}
      </p>
    </div>
  )
}
