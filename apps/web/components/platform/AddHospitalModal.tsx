'use client'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, Field, Input, Modal } from '@/components/ui/kit'
import { platformApiClient } from '@/lib/platform'

/**
 * Direct hospital creation: a platform operator vouches for the account, so
 * this skips the self-serve email-verify flow entirely and sets the admin's
 * password directly (same "admin sets initial password, no invite email"
 * pattern HR's Add User modal already uses).
 */
export function AddHospitalModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [adminFullName, setAdminFullName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [err, setErr] = useState('')

  const valid =
    name.trim().length >= 2 &&
    adminFullName.trim().length >= 1 &&
    /\S+@\S+\.\S+/.test(adminEmail) &&
    adminPassword.length >= 8

  const m = useMutation({
    mutationFn: () =>
      platformApiClient.tenants.create({
        name: name.trim(),
        address: address.trim() || undefined,
        adminFullName: adminFullName.trim(),
        adminEmail: adminEmail.trim().toLowerCase(),
        adminPassword,
      }),
    onSuccess: () => {
      reset()
      onCreated()
    },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not create this hospital.'),
  })

  function reset() {
    setName('')
    setAddress('')
    setAdminFullName('')
    setAdminEmail('')
    setAdminPassword('')
    setErr('')
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Add new hospital"
      width={520}
      align="center"
    >
      <div className="space-y-3">
        <Field label="Hospital name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grace Hospital" />
        </Field>
        <Field label="Location">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="City, state" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Admin full name" required>
            <Input value={adminFullName} onChange={(e) => setAdminFullName(e.target.value)} placeholder="Full name" />
          </Field>
          <Field label="Admin email" required>
            <Input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@hospital.com" />
          </Field>
        </div>
        <Field label="Initial password" required>
          <Input
            type="text"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
        </Field>
        <p className="text-xs text-gray-400">
          The hospital starts on a trial immediately. Share this password with the admin directly - no invite email is sent.
        </p>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button loading={m.isPending} disabled={!valid} onClick={() => { setErr(''); m.mutate() }}>
            Create hospital
          </Button>
        </div>
      </div>
    </Modal>
  )
}
