'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Modal } from '@/components/ui/kit'
import { useToast } from '@/components/ui/feedback'
import { platformApiClient } from '@/lib/platform'

export function MaintenanceModeTab() {
  const toast = useToast()
  const qc = useQueryClient()
  const config = useQuery({ queryKey: ['platform-config'], queryFn: platformApiClient.config.get })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [understood, setUnderstood] = useState(false)

  const m = useMutation({
    mutationFn: (maintenanceMode: boolean) => platformApiClient.config.setMaintenanceMode(maintenanceMode),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['platform-config'] })
      toast(data.maintenanceMode ? 'Maintenance mode enabled' : 'Maintenance mode disabled', data.maintenanceMode ? 'error' : 'success')
      setConfirmOpen(false)
      setUnderstood(false)
    },
  })

  if (!config.data) return <p className="text-sm text-gray-400">Loading…</p>

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-white border border-gray-100 rounded-xl p-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Maintenance mode</h2>
          <p className="text-xs text-gray-500 mt-1 max-w-md">
            {config.data.maintenanceMode
              ? 'The platform is currently down for every hospital. Only platform operators can sign in.'
              : 'Every hospital dashboard is reachable normally.'}
          </p>
        </div>
        {config.data.maintenanceMode ? (
          <Button variant="secondary" loading={m.isPending} onClick={() => m.mutate(false)}>Disable</Button>
        ) : (
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>Enable</Button>
        )}
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false); setUnderstood(false) }}
        title="Enable maintenance mode?"
        width={520}
        align="center"
      >
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-100 rounded-lg p-4">
            <p className="text-sm font-semibold text-red-700">This affects ALL hospitals</p>
            <p className="text-sm text-red-600 mt-1">
              Every hospital dashboard will be rejected until you turn this off. Platform operators can still sign in.
            </p>
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5" />
            I understand this will take the entire platform offline for all hospitals.
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setConfirmOpen(false); setUnderstood(false) }}>Cancel</Button>
            <Button variant="danger" disabled={!understood} loading={m.isPending} onClick={() => m.mutate(true)}>
              Enable maintenance mode
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
