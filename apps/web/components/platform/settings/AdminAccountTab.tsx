'use client'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Field, Input } from '@/components/ui/kit'
import { useToast } from '@/components/ui/feedback'
import { platformApiClient } from '@/lib/platform'

export function AdminAccountTab() {
  const toast = useToast()
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['platform-me'], queryFn: platformApiClient.auth.me })

  const [fullName, setFullName] = useState('')
  useEffect(() => {
    if (me.data) setFullName(me.data.fullName)
  }, [me.data])

  const profile = useMutation({
    mutationFn: () => platformApiClient.auth.updateProfile({ fullName: fullName.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-me'] })
      toast('Profile updated', 'success')
    },
    onError: () => toast('Could not update your profile', 'error'),
  })

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordErr, setPasswordErr] = useState('')

  const passwordValid = currentPassword.length > 0 && newPassword.length >= 12 && newPassword === confirmPassword

  const password = useMutation({
    mutationFn: () => platformApiClient.auth.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      toast('Password changed', 'success')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordErr('')
    },
    onError: (e: any) => setPasswordErr(e?.response?.data?.message ?? 'Could not change your password.'),
  })

  if (!me.data) return <p className="text-sm text-gray-400">Loading…</p>

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Your profile</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Full name">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
          <Field label="Email">
            <Input value={me.data.email} disabled />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button
            loading={profile.isPending}
            disabled={!fullName.trim() || fullName.trim() === me.data.fullName}
            onClick={() => profile.mutate()}
          >
            Save changes
          </Button>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Change password</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Current password" required>
            <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </Field>
          <div />
          <Field label="New password" required>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 12 characters" />
          </Field>
          <Field label="Confirm new password" required>
            <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </Field>
        </div>
        {passwordErr && <p className="text-sm text-red-600">{passwordErr}</p>}
        <div className="flex justify-end">
          <Button loading={password.isPending} disabled={!passwordValid} onClick={() => { setPasswordErr(''); password.mutate() }}>
            Update password
          </Button>
        </div>
      </div>
    </div>
  )
}
