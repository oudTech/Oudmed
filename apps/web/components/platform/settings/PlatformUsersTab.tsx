'use client'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Field, Input, Modal } from '@/components/ui/kit'
import { useConfirm, useToast } from '@/components/ui/feedback'
import { platformApiClient } from '@/lib/platform'

/**
 * Plain list/invite/deactivate - no granular roles or permissions yet (a
 * deliberate scope decision; every platform user has full access today, see
 * PlatformAuthGuard). Deliberately replaces a "Roles & Permission" editor.
 */
export function PlatformUsersTab() {
  const qc = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [addOpen, setAddOpen] = useState(false)
  const users = useQuery({ queryKey: ['platform-users'], queryFn: platformApiClient.users.list })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['platform-users'] })
  const deactivate = useMutation({ mutationFn: (id: string) => platformApiClient.users.deactivate(id), onSuccess: invalidate })
  const reactivate = useMutation({ mutationFn: (id: string) => platformApiClient.users.reactivate(id), onSuccess: invalidate })

  async function handleDeactivate(id: string, email: string) {
    const ok = await confirm({
      title: 'Deactivate this platform user?',
      body: `${email} will immediately lose access to the Super Admin dashboard.`,
      confirmLabel: 'Deactivate',
      danger: true,
    })
    if (!ok) return
    deactivate.mutate(id, {
      onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not deactivate this user.', 'error'),
    })
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Platform users</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Every platform user has full access today - granular roles are not yet available.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>+ Add platform user</Button>
      </div>

      <div className="border border-gray-100 rounded-xl overflow-hidden">
        {!users.data ? (
          <p className="p-4 text-sm text-gray-400">Loading…</p>
        ) : users.data.length === 0 ? (
          <p className="p-4 text-sm text-gray-400">No platform users yet.</p>
        ) : (
          users.data.map((u) => (
            <div key={u.id} className="flex items-center justify-between px-4 py-3 border-b border-gray-100 last:border-b-0 text-sm">
              <div>
                <p className="font-medium text-gray-900">{u.fullName}</p>
                <p className="text-gray-400">{u.email}</p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className="text-xs font-medium rounded-full px-2 py-0.5"
                  style={u.isActive ? { color: '#047857', backgroundColor: '#EAF7F0' } : { color: '#6B7280', backgroundColor: '#F3F4F6' }}
                >
                  {u.isActive ? 'Active' : 'Inactive'}
                </span>
                {u.isActive ? (
                  <button onClick={() => handleDeactivate(u.id, u.email)} className="text-red-600 hover:underline">Deactivate</button>
                ) : (
                  <button onClick={() => reactivate.mutate(u.id)} className="text-primary hover:underline">Reactivate</button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {addOpen && (
        <AddPlatformUserModal onClose={() => setAddOpen(false)} onCreated={() => { invalidate(); setAddOpen(false) }} />
      )}
    </div>
  )
}

function AddPlatformUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const valid = fullName.trim().length >= 1 && /\S+@\S+\.\S+/.test(email) && password.length >= 12

  const m = useMutation({
    mutationFn: () => platformApiClient.users.create({ fullName: fullName.trim(), email: email.trim().toLowerCase(), password }),
    onSuccess: onCreated,
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not add this platform user.'),
  })

  return (
    <Modal open onClose={onClose} title="Add platform user" width={480} align="center">
      <div className="space-y-3">
        <Field label="Full name" required>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Email" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Initial password" required>
          <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 12 characters" />
        </Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} disabled={!valid} onClick={() => { setErr(''); m.mutate() }}>
            Add user
          </Button>
        </div>
      </div>
    </Modal>
  )
}
