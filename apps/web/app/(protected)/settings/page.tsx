'use client'
import { Suspense, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import type { HospitalSettingsDTO, SubscriptionInvoiceDTO } from '@oudhealth/contracts'
import { Button, Field, Input, Textarea } from '@/components/ui/kit'
import { useToast } from '@/components/ui/feedback'
import { can } from '@/lib/permissions'
import { settingsApi } from '@/lib/settings'
import { uploadError } from '@/lib/storage'
import { subscriptionsApi } from '@/lib/subscriptions'
import { naira } from '@/lib/billing'

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  )
}

function SettingsPageInner() {
  const { data: session, update } = useSession()
  const allowed = can(session?.role, 'admin:settings')
  const qc = useQueryClient()

  const q = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get, enabled: allowed })

  if (!allowed) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Settings</h1>
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6">
          Only a hospital admin can change hospital settings.
        </p>
      </div>
    )
  }

  const refresh = async (s: HospitalSettingsDTO) => {
    qc.setQueryData(['settings'], s)
    // pull fresh tenant branding into the NextAuth session (sidebar logo / colour)
    await update?.({ apiToken: (session as any)?.apiToken }).catch(() => undefined)
  }

  return (
    <div className="flex flex-col h-full bg-[#F7F9FC] overflow-hidden">
      <div className="px-8 pt-7 pb-4 flex-shrink-0 bg-white border-b border-[#D6DEE8]">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Hospital profile, branding and document numbering.</p>
      </div>

      <div data-tour="settings-sections" className="flex-1 overflow-y-auto px-8 py-6 max-w-3xl space-y-6">
        {!q.data ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <>
            <ProfileSection s={q.data} onSaved={refresh} />
            <BrandingSection s={q.data} onSaved={refresh} />
            <DocumentsSection s={q.data} onSaved={refresh} />
            <BillingSection />
          </>
        )}
      </div>
    </div>
  )
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6">
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      {subtitle && <p className="text-sm text-gray-500 mb-4">{subtitle}</p>}
      <div className={subtitle ? '' : 'mt-4'}>{children}</div>
    </div>
  )
}

function useSectionForm<T extends Record<string, unknown>>(initial: T) {
  const [form, setForm] = useState(initial)
  useEffect(() => setForm(initial), [JSON.stringify(initial)]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof T, v: unknown) => setForm((f) => ({ ...f, [k]: v }))
  return { form, set }
}

function ProfileSection({ s, onSaved }: { s: HospitalSettingsDTO; onSaved: (s: HospitalSettingsDTO) => void }) {
  const { form, set } = useSectionForm({
    name: s.name, address: s.address ?? '', phone: s.phone ?? '', contactEmail: s.contactEmail ?? '',
    website: s.website ?? '', rcNumber: s.rcNumber ?? '', taxId: s.taxId ?? '',
  })
  const [err, setErr] = useState('')
  const m = useMutation({
    mutationFn: () => settingsApi.update(form),
    onSuccess: onSaved,
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not save.'),
  })
  return (
    <Card title="Hospital profile" subtitle="Shown on invoices, receipts and the login page.">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Hospital name" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Contact email"><Input type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} /></Field>
        <Field label="Website"><Input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" /></Field>
        <div className="sm:col-span-2"><Field label="Address"><Input value={form.address} onChange={(e) => set('address', e.target.value)} /></Field></div>
        <Field label="RC number"><Input value={form.rcNumber} onChange={(e) => set('rcNumber', e.target.value)} placeholder="Corporate registration" /></Field>
        <Field label="Tax ID (TIN)"><Input value={form.taxId} onChange={(e) => set('taxId', e.target.value)} /></Field>
      </div>
      {err && <p className="text-sm text-red-600 mt-3">{err}</p>}
      <div className="mt-4 flex justify-end">
        <Button loading={m.isPending} disabled={form.name.trim().length < 2} onClick={() => { setErr(''); m.mutate() }}>
          Save profile
        </Button>
      </div>
    </Card>
  )
}

function BrandingSection({ s, onSaved }: { s: HospitalSettingsDTO; onSaved: (s: HospitalSettingsDTO) => void }) {
  const [color, setColor] = useState(s.primaryColor)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => setColor(s.primaryColor), [s.primaryColor])

  const saveColor = useMutation({
    mutationFn: () => settingsApi.update({ primaryColor: color }),
    onSuccess: onSaved,
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not save.'),
  })
  const upload = useMutation({
    mutationFn: (f: File) => settingsApi.setLogo(f),
    onSuccess: onSaved,
    onError: (e) => setErr(uploadError(e)),
  })
  const clearLogo = useMutation({ mutationFn: () => settingsApi.removeLogo(), onSuccess: onSaved })

  return (
    <Card title="Branding">
      <div className="flex items-start gap-6">
        <div className="flex flex-col items-center gap-2">
          <div className="w-24 h-24 rounded-xl border border-gray-200 flex items-center justify-center overflow-hidden bg-gray-50">
            {s.logoUrl ? (
              <Image src={s.logoUrl} alt="Logo" width={96} height={96} className="object-contain" unoptimized />
            ) : (
              <span className="text-2xl font-bold" style={{ color }}>{s.name.charAt(0)}</span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { setErr(''); upload.mutate(f) } }}
          />
          <div className="flex gap-2">
            <button className="text-xs text-primary hover:underline" onClick={() => fileRef.current?.click()}>
              {upload.isPending ? 'Uploading…' : 'Upload logo'}
            </button>
            {s.logoUrl && (
              <button className="text-xs text-red-500 hover:underline" onClick={() => clearLogo.mutate()}>Remove</button>
            )}
          </div>
        </div>
        <div className="flex-1">
          <Field label="Primary colour">
            <div className="flex items-center gap-3">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-14 rounded border border-gray-200" />
              <Input value={color} onChange={(e) => setColor(e.target.value)} className="w-32" />
            </div>
          </Field>
          <p className="text-xs text-gray-400 mt-1">Used for the sidebar, buttons and accents. PNG / JPEG / WebP logo, up to 20 MB.</p>
          <div className="mt-3">
            <Button variant="secondary" loading={saveColor.isPending} onClick={() => { setErr(''); saveColor.mutate() }}>Save colour</Button>
          </div>
        </div>
      </div>
      {err && <p className="text-sm text-red-600 mt-3">{err}</p>}
    </Card>
  )
}

function DocumentsSection({ s, onSaved }: { s: HospitalSettingsDTO; onSaved: (s: HospitalSettingsDTO) => void }) {
  const { form, set } = useSectionForm({
    invoicePrefix: s.invoicePrefix, receiptPrefix: s.receiptPrefix, documentFooter: s.documentFooter ?? '',
  })
  const [err, setErr] = useState('')
  const m = useMutation({
    mutationFn: () => settingsApi.update(form),
    onSuccess: onSaved,
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Could not save.'),
  })
  return (
    <Card title="Documents & numbering" subtitle="Prefixes apply to invoices and receipts raised from now on.">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Invoice prefix"><Input value={form.invoicePrefix} onChange={(e) => set('invoicePrefix', e.target.value.toUpperCase())} placeholder="INV" /></Field>
        <Field label="Receipt prefix"><Input value={form.receiptPrefix} onChange={(e) => set('receiptPrefix', e.target.value.toUpperCase())} placeholder="RCP" /></Field>
        <div className="sm:col-span-2">
          <Field label="Footer text">
            <Textarea rows={2} value={form.documentFooter} onChange={(e) => set('documentFooter', e.target.value)} placeholder="Printed at the bottom of every invoice and receipt" />
          </Field>
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-1">
        Next invoice: <span className="font-mono">{form.invoicePrefix || 'INV'}-000NNN</span>
      </p>
      {err && <p className="text-sm text-red-600 mt-3">{err}</p>}
      <div className="mt-4 flex justify-end">
        <Button loading={m.isPending} disabled={!form.invoicePrefix.trim() || !form.receiptPrefix.trim()} onClick={() => { setErr(''); m.mutate() }}>
          Save
        </Button>
      </div>
    </Card>
  )
}

const STATUS_LABEL: Record<string, string> = {
  TRIALING: 'Trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Payment overdue',
  SUSPENDED: 'Suspended',
  CANCELLED: 'Cancelled',
}

const INVOICE_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  PAID: 'Paid',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
}

function BillingSection() {
  const router = useRouter()
  const params = useSearchParams()
  const toast = useToast()
  const qc = useQueryClient()
  const [cycle, setCycle] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY')
  const [transferInvoice, setTransferInvoice] = useState<SubscriptionInvoiceDTO | null>(null)

  const q = useQuery({ queryKey: ['subscription-me'], queryFn: subscriptionsApi.getMine })
  const invoices = useQuery({ queryKey: ['subscription-invoices'], queryFn: subscriptionsApi.listInvoices })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['subscription-me'] })
    qc.invalidateQueries({ queryKey: ['subscription-invoices'] })
  }

  const card = useMutation({
    mutationFn: () => subscriptionsApi.checkoutCard(cycle),
    onSuccess: (r) => { window.location.href = r.authorizationUrl },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not start checkout.', 'error'),
  })
  const bankTransfer = useMutation({
    mutationFn: () => subscriptionsApi.checkoutBankTransfer(cycle),
    onSuccess: (inv) => { setTransferInvoice(inv); invalidate() },
    onError: (e: any) => toast(e?.response?.data?.message ?? 'Could not create the invoice.', 'error'),
  })

  // Returning from Paystack's checkout page: verify now rather than wait for
  // the webhook, so the customer isn't stuck looking at "pending".
  useEffect(() => {
    const reference = params.get('reference')
    if (params.get('checkout') === 'return' && reference) {
      subscriptionsApi
        .verifyCheckout(reference)
        .then((inv) => {
          toast(inv.status === 'PAID' ? 'Payment received - thank you!' : 'Payment is still processing.', inv.status === 'PAID' ? 'success' : 'info')
          invalidate()
        })
        .catch(() => toast('Could not confirm payment status yet.', 'error'))
        .finally(() => router.replace('/settings'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!q.data) {
    return (
      <Card title="Plan & billing" subtitle="Your seats and what they cost.">
        <p className="text-sm text-gray-400">Loading…</p>
      </Card>
    )
  }
  const s = q.data
  const net = cycle === 'MONTHLY' ? s.seats.monthlyNet : s.seats.annualNet
  const vat = cycle === 'MONTHLY' ? s.seats.monthlyVat : s.seats.annualVat
  const gross = cycle === 'MONTHLY' ? s.seats.monthlyGross : s.seats.annualGross
  const totalSeats = s.seats.adminSeats + s.seats.otherSeats

  return (
    <>
      <Card title="Plan & billing" subtitle="Your seats and what they cost.">
        {s.status === 'TRIALING' && s.trialDaysRemaining !== null && (
          <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-sm text-blue-700 mb-4">
            {s.trialDaysRemaining === 0
              ? 'Your trial ends today.'
              : `${s.trialDaysRemaining} day${s.trialDaysRemaining === 1 ? '' : 's'} left in your trial.`}
          </div>
        )}
        {s.status !== 'TRIALING' && (
          <div className="mb-4">
            <span className="text-xs font-medium rounded-full px-2 py-0.5 bg-gray-100 text-gray-600">
              {STATUS_LABEL[s.status] ?? s.status}
            </span>
          </div>
        )}

        <div className="inline-flex items-center rounded-lg border border-gray-200 p-0.5 mb-4">
          {(['MONTHLY', 'ANNUAL'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCycle(c)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                cycle === c ? 'bg-primary text-white' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {c === 'MONTHLY' ? 'Monthly' : `Annually (save ${Number(s.pricing.annualDiscountPct)}%)`}
            </button>
          ))}
        </div>

        <div className="border border-gray-100 rounded-xl divide-y divide-gray-100 text-sm">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-gray-500">Admin seats ({s.seats.adminSeats})</span>
            <span>{naira(s.pricing.adminSeatPriceMonthly)} / mo each</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-gray-500">Other staff seats ({s.seats.otherSeats})</span>
            <span>{naira(s.pricing.otherSeatPriceMonthly)} / mo each</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <span>{totalSeats} seat{totalSeats === 1 ? '' : 's'} - subtotal</span>
            <span>{naira(net)}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 text-gray-500">
            <span>VAT ({Number(s.pricing.vatPct)}%)</span>
            <span>{naira(vat)}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 font-semibold text-gray-900">
            <span>Total</span>
            <span>{naira(gross)}{cycle === 'MONTHLY' ? ' / month' : ' / year'}</span>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Priced by active staff account, not role - deactivating a staff member frees that seat.
        </p>

        <div className="flex items-center gap-2 mt-4">
          <Button loading={card.isPending} onClick={() => card.mutate()}>Pay with card</Button>
          <Button variant="secondary" loading={bankTransfer.isPending} onClick={() => bankTransfer.mutate()}>
            Pay by bank transfer
          </Button>
        </div>
      </Card>

      {transferInvoice && (
        <Card title="Bank transfer details">
          <p className="text-sm text-gray-600">
            Transfer <span className="font-semibold">{naira(transferInvoice.totalAmount)}</span> and reference{' '}
            <span className="font-mono font-semibold">{transferInvoice.invoiceNumber}</span> so we can match it to
            this invoice. Our account details will be sent to you separately - once we receive it, an admin marks
            this invoice paid and your plan activates.
          </p>
          <div className="mt-3 flex justify-end">
            <Button variant="secondary" onClick={() => setTransferInvoice(null)}>Close</Button>
          </div>
        </Card>
      )}

      <Card title="Invoices">
        {!invoices.data?.length ? (
          <p className="text-sm text-gray-400">No invoices yet.</p>
        ) : (
          <ul className="border border-gray-100 rounded-xl divide-y divide-gray-100 text-sm">
            {invoices.data.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between px-3 py-2">
                <div>
                  <p className="font-medium text-gray-900">{inv.invoiceNumber}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(inv.createdAt).toLocaleDateString('en-GB')} · {inv.billingCycle === 'MONTHLY' ? 'Monthly' : 'Annual'} ·{' '}
                    {inv.paymentMethod === 'CARD' ? 'Card' : 'Bank transfer'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-gray-700">{naira(inv.totalAmount)}</span>
                  <span
                    className={`text-xs font-medium rounded-full px-2 py-0.5 ${
                      inv.status === 'PAID' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {INVOICE_STATUS_LABEL[inv.status] ?? inv.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
