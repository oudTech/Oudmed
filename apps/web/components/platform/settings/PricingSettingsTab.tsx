'use client'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Field, Input } from '@/components/ui/kit'
import { useToast } from '@/components/ui/feedback'
import { platformApiClient } from '@/lib/platform'

export function PricingSettingsTab() {
  const toast = useToast()
  const qc = useQueryClient()
  const pricing = useQuery({ queryKey: ['platform-pricing'], queryFn: platformApiClient.pricing.get })

  const [form, setForm] = useState({
    adminSeatPriceMonthly: '',
    otherSeatPriceMonthly: '',
    annualDiscountPct: '',
    vatPct: '',
    platformTin: '',
    trialDays: '',
  })

  useEffect(() => {
    if (!pricing.data) return
    setForm({
      adminSeatPriceMonthly: pricing.data.adminSeatPriceMonthly,
      otherSeatPriceMonthly: pricing.data.otherSeatPriceMonthly,
      annualDiscountPct: pricing.data.annualDiscountPct,
      vatPct: pricing.data.vatPct,
      platformTin: pricing.data.platformTin ?? '',
      trialDays: String(pricing.data.trialDays),
    })
  }, [pricing.data])

  const m = useMutation({
    mutationFn: () =>
      platformApiClient.pricing.update({
        adminSeatPriceMonthly: Number(form.adminSeatPriceMonthly),
        otherSeatPriceMonthly: Number(form.otherSeatPriceMonthly),
        annualDiscountPct: Number(form.annualDiscountPct),
        vatPct: Number(form.vatPct),
        platformTin: form.platformTin.trim() || null,
        trialDays: Number(form.trialDays),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-pricing'] })
      toast('Pricing updated', 'success')
    },
    onError: () => toast('Could not update pricing', 'error'),
  })

  if (!pricing.data) return <p className="text-sm text-gray-400">Loading…</p>

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Per-seat pricing</h2>
        <p className="text-xs text-gray-400">
          Applies to every hospital's next billing cycle - current periods are not retroactively changed.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Admin seat (₦/month)">
            <Input type="number" min={0} value={form.adminSeatPriceMonthly} onChange={(e) => setForm((f) => ({ ...f, adminSeatPriceMonthly: e.target.value }))} />
          </Field>
          <Field label="Other seat (₦/month)">
            <Input type="number" min={0} value={form.otherSeatPriceMonthly} onChange={(e) => setForm((f) => ({ ...f, otherSeatPriceMonthly: e.target.value }))} />
          </Field>
          <Field label="Annual discount (%)">
            <Input type="number" min={0} max={100} value={form.annualDiscountPct} onChange={(e) => setForm((f) => ({ ...f, annualDiscountPct: e.target.value }))} />
          </Field>
          <Field label="VAT (%)">
            <Input type="number" min={0} max={100} value={form.vatPct} onChange={(e) => setForm((f) => ({ ...f, vatPct: e.target.value }))} />
          </Field>
          <Field label="Trial length (days)">
            <Input type="number" min={0} max={365} value={form.trialDays} onChange={(e) => setForm((f) => ({ ...f, trialDays: e.target.value }))} />
          </Field>
          <Field label="Platform TIN">
            <Input value={form.platformTin} onChange={(e) => setForm((f) => ({ ...f, platformTin: e.target.value }))} placeholder="Printed on subscription invoices" />
          </Field>
        </div>
      </div>
      <div className="flex justify-end">
        <Button loading={m.isPending} onClick={() => m.mutate()}>Save changes</Button>
      </div>
    </div>
  )
}
