'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DoctorShiftDTO } from '@oudhealth/contracts'
import { Modal, Button } from '@/components/ui/kit'
import { getDoctorShifts, setDoctorShifts } from '@/lib/hospital'

const DAYS = [
  { i: 1, l: 'Monday' },
  { i: 2, l: 'Tuesday' },
  { i: 3, l: 'Wednesday' },
  { i: 4, l: 'Thursday' },
  { i: 5, l: 'Friday' },
  { i: 6, l: 'Saturday' },
  { i: 0, l: 'Sunday' },
]

const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const toMin = (s: string) => {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

type Row = { on: boolean; start: string; end: string }

export function DoctorHoursModal({
  doctor,
  onClose,
}: {
  doctor: { id: string; name: string } | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [rows, setRows] = useState<Record<number, Row> | null>(null)

  const existing = useQuery({
    queryKey: ['shifts', doctor?.id],
    queryFn: () => getDoctorShifts(doctor!.id),
    enabled: !!doctor,
  })

  // hydrate once
  if (doctor && existing.data && rows === null) {
    const byDay: Record<number, DoctorShiftDTO> = {}
    for (const s of existing.data) byDay[s.dayOfWeek] = s
    const next: Record<number, Row> = {}
    for (const d of DAYS) {
      const s = byDay[d.i]
      next[d.i] = s
        ? { on: true, start: toHHMM(s.startMinute), end: toHHMM(s.endMinute) }
        : { on: false, start: '08:00', end: '16:00' }
    }
    setRows(next)
  }

  const save = useMutation({
    mutationFn: () => {
      const shifts: DoctorShiftDTO[] = DAYS.filter((d) => rows![d.i].on).map((d) => ({
        dayOfWeek: d.i,
        startMinute: toMin(rows![d.i].start),
        endMinute: toMin(rows![d.i].end),
      }))
      return setDoctorShifts(doctor!.id, shifts)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctors'] })
      qc.invalidateQueries({ queryKey: ['shifts', doctor?.id] })
      handleClose()
    },
  })

  const handleClose = () => {
    setRows(null)
    onClose()
  }

  return (
    <Modal open={!!doctor} onClose={handleClose} title={`Working hours - ${doctor?.name ?? ''}`} width={460}>
      {!rows ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-1.5">
          {DAYS.map((d) => {
            const r = rows[d.i]
            return (
              <div key={d.i} className="flex items-center gap-3 py-1">
                <label className="flex items-center gap-2 w-28 flex-shrink-0 text-sm">
                  <input
                    type="checkbox"
                    checked={r.on}
                    onChange={(e) =>
                      setRows({ ...rows, [d.i]: { ...r, on: e.target.checked } })
                    }
                    className="h-4 w-4 rounded border-gray-300 text-primary"
                  />
                  {d.l}
                </label>
                <input
                  type="time"
                  value={r.start}
                  disabled={!r.on}
                  onChange={(e) => setRows({ ...rows, [d.i]: { ...r, start: e.target.value } })}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-sm disabled:bg-gray-50 disabled:text-gray-300"
                />
                <span className="text-gray-400 text-sm">to</span>
                <input
                  type="time"
                  value={r.end}
                  disabled={!r.on}
                  onChange={(e) => setRows({ ...rows, [d.i]: { ...r, end: e.target.value } })}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-sm disabled:bg-gray-50 disabled:text-gray-300"
                />
              </div>
            )
          })}
          {save.isError && <p className="text-sm text-red-600 pt-1">Could not save hours.</p>}
          <div className="flex justify-end gap-2 pt-3">
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Save hours
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
