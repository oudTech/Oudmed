'use client'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Field, Input, Select } from '@/components/ui/kit'
import { useToast } from '@/components/ui/feedback'
import { platformApiClient } from '@/lib/platform'

export function GeneralSettingsTab() {
  const toast = useToast()
  const qc = useQueryClient()
  const config = useQuery({ queryKey: ['platform-config'], queryFn: platformApiClient.config.get })

  const [form, setForm] = useState({
    platformName: '',
    supportEmail: '',
    supportPhone: '',
    supportHours: '',
    defaultCountry: '',
    defaultCurrency: '',
    timeFormat: '12h',
  })

  useEffect(() => {
    if (!config.data) return
    setForm({
      platformName: config.data.platformName,
      supportEmail: config.data.supportEmail ?? '',
      supportPhone: config.data.supportPhone ?? '',
      supportHours: config.data.supportHours ?? '',
      defaultCountry: config.data.defaultCountry,
      defaultCurrency: config.data.defaultCurrency,
      timeFormat: config.data.timeFormat,
    })
  }, [config.data])

  const m = useMutation({
    mutationFn: () =>
      platformApiClient.config.update({
        platformName: form.platformName.trim(),
        supportEmail: form.supportEmail.trim() || undefined,
        supportPhone: form.supportPhone.trim() || undefined,
        supportHours: form.supportHours.trim() || undefined,
        defaultCountry: form.defaultCountry.trim(),
        defaultCurrency: form.defaultCurrency.trim(),
        timeFormat: form.timeFormat,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-config'] })
      toast('Settings saved', 'success')
    },
    onError: () => toast('Could not save settings', 'error'),
  })

  if (!config.data) return <p className="text-sm text-gray-400">Loading…</p>

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Platform configuration</h2>
        <p className="text-xs text-gray-400">How the platform is presented to hospitals and their staff.</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Platform name">
            <Input value={form.platformName} onChange={(e) => setForm((f) => ({ ...f, platformName: e.target.value }))} />
          </Field>
          <Field label="Support email">
            <Input type="email" value={form.supportEmail} onChange={(e) => setForm((f) => ({ ...f, supportEmail: e.target.value }))} />
          </Field>
          <Field label="Support phone">
            <Input value={form.supportPhone} onChange={(e) => setForm((f) => ({ ...f, supportPhone: e.target.value }))} />
          </Field>
          <Field label="Support hours">
            <Input
              value={form.supportHours}
              onChange={(e) => setForm((f) => ({ ...f, supportHours: e.target.value }))}
              placeholder="Mon-Fri, 8:00 AM - 6:00 PM"
            />
          </Field>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Regional defaults</h2>
        <p className="text-xs text-gray-400">Applied to new hospitals only. Existing hospitals keep their own preferences.</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Default country">
            <Input
              value={form.defaultCountry}
              onChange={(e) => setForm((f) => ({ ...f, defaultCountry: e.target.value.toUpperCase() }))}
              maxLength={2}
            />
          </Field>
          <Field label="Default currency">
            <Input
              value={form.defaultCurrency}
              onChange={(e) => setForm((f) => ({ ...f, defaultCurrency: e.target.value.toUpperCase() }))}
              maxLength={8}
            />
          </Field>
          <Field label="Time format">
            <Select value={form.timeFormat} onChange={(e) => setForm((f) => ({ ...f, timeFormat: e.target.value }))}>
              <option value="12h">12-hour (AM/PM)</option>
              <option value="24h">24-hour</option>
            </Select>
          </Field>
        </div>
      </div>

      <div className="flex justify-end">
        <Button loading={m.isPending} onClick={() => m.mutate()}>Save changes</Button>
      </div>
    </div>
  )
}
