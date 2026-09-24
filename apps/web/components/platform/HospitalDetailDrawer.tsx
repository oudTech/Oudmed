'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Drawer, Button } from '@/components/ui/kit'
import { useConfirm, useToast } from '@/components/ui/feedback'
import { platformApiClient, naira, STATUS_BADGE, STATUS_LABEL } from '@/lib/platform'

const INVOICE_STATUS_BADGE: Record<string, { color: string; bg: string }> = {
  PAID: { color: '#047857', bg: '#EAF7F0' },
  PENDING: { color: '#B45309', bg: '#FFF6E5' },
  FAILED: { color: '#B91C1C', bg: '#FEECEC' },
  CANCELLED: { color: '#6B7280', bg: '#F3F4F6' },
}

export function HospitalDetailDrawer({
  tenantId,
  onClose,
  onChanged,
}: {
  tenantId: string
  onClose: () => void
  onChanged: () => void
}) {
  const confirm = useConfirm()
  const toast = useToast()
  const qc = useQueryClient()
  const detailKey = ['platform-hospital', tenantId]
  const detail = useQuery({ queryKey: detailKey, queryFn: () => platformApiClient.tenants.get(tenantId) })

  const invalidate = () => qc.invalidateQueries({ queryKey: detailKey })

  const suspend = useMutation({
    mutationFn: () => platformApiClient.tenants.suspend(tenantId),
    onSuccess: () => { invalidate(); onChanged(); toast('Hospital suspended', 'success') },
  })
  const reactivate = useMutation({
    mutationFn: () => platformApiClient.tenants.reactivate(tenantId),
    onSuccess: () => { invalidate(); onChanged(); toast('Hospital reactivated', 'success') },
  })
  const markPaid = useMutation({
    mutationFn: (invoiceId: string) => platformApiClient.subscriptions.markInvoicePaid(tenantId, invoiceId),
    onSuccess: () => { invalidate(); onChanged(); toast('Invoice marked as paid', 'success') },
  })

  const t = detail.data

  async function handleSuspend() {
    const ok = await confirm({
      title: 'Suspend this hospital?',
      body: `${t?.name} and every one of its staff will immediately lose access. This can be reversed at any time.`,
      confirmLabel: 'Suspend',
      danger: true,
    })
    if (ok) suspend.mutate()
  }

  async function handleReactivate() {
    const ok = await confirm({
      title: 'Reactivate this hospital?',
      body: `${t?.name}'s staff will immediately regain access.`,
      confirmLabel: 'Reactivate',
    })
    if (ok) reactivate.mutate()
  }

  return (
    <Drawer open onClose={onClose} title={t?.name ?? 'Hospital'} width={480}>
      {!t ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <span
              className="text-xs font-medium rounded-full px-2 py-0.5"
              style={{ color: STATUS_BADGE[t.subscriptionStatus]?.color, backgroundColor: STATUS_BADGE[t.subscriptionStatus]?.bg }}
            >
              {t.isActive ? STATUS_LABEL[t.subscriptionStatus] ?? t.subscriptionStatus : 'Suspended'}
            </span>
            {t.isActive ? (
              <Button variant="danger" loading={suspend.isPending} onClick={handleSuspend}>Suspend</Button>
            ) : (
              <Button loading={reactivate.isPending} onClick={handleReactivate}>Reactivate</Button>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-gray-400">Contact email</dt><dd className="text-gray-900">{t.contactEmail ?? '-'}</dd></div>
            <div><dt className="text-gray-400">Location</dt><dd className="text-gray-900">{t.address ?? '-'}</dd></div>
            <div><dt className="text-gray-400">Users</dt><dd className="text-gray-900 tabular-nums">{t.users}</dd></div>
            <div><dt className="text-gray-400">Patients</dt><dd className="text-gray-900 tabular-nums">{t.patients}</dd></div>
            <div><dt className="text-gray-400">Monthly revenue</dt><dd className="text-gray-900 tabular-nums">{naira(t.monthlyRevenue)}</dd></div>
            <div><dt className="text-gray-400">Joined</dt><dd className="text-gray-900">{new Date(t.joinedAt).toLocaleDateString()}</dd></div>
            {t.trialEndsAt && (
              <div><dt className="text-gray-400">Trial ends</dt><dd className="text-gray-900">{new Date(t.trialEndsAt).toLocaleDateString()}</dd></div>
            )}
            {t.currentPeriodEnd && (
              <div><dt className="text-gray-400">Renews</dt><dd className="text-gray-900">{new Date(t.currentPeriodEnd).toLocaleDateString()}</dd></div>
            )}
          </dl>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Invoices</h3>
            {t.invoices.length === 0 ? (
              <p className="text-sm text-gray-400">No invoices yet.</p>
            ) : (
              <div className="border border-gray-100 rounded-lg overflow-hidden">
                {t.invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between px-3 py-2 text-sm border-b border-gray-100 last:border-b-0">
                    <div>
                      <p className="font-medium text-gray-900">{inv.invoiceNumber}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(inv.createdAt).toLocaleDateString()} · {inv.paymentMethod === 'BANK_TRANSFER' ? 'Bank transfer' : 'Card'}
                      </p>
                    </div>
                    <div className="text-right flex items-center gap-2">
                      <div>
                        <p className="font-medium text-gray-900 tabular-nums">{naira(inv.totalAmount)}</p>
                        <span
                          className="text-[11px] font-medium rounded-full px-1.5 py-0.5"
                          style={{ color: (INVOICE_STATUS_BADGE[inv.status] ?? INVOICE_STATUS_BADGE.CANCELLED).color, backgroundColor: (INVOICE_STATUS_BADGE[inv.status] ?? INVOICE_STATUS_BADGE.CANCELLED).bg }}
                        >
                          {inv.status}
                        </span>
                      </div>
                      {inv.status === 'PENDING' && inv.paymentMethod === 'BANK_TRANSFER' && (
                        <Button
                          variant="secondary"
                          className="!px-2 !py-1 text-xs"
                          loading={markPaid.isPending}
                          onClick={() => markPaid.mutate(inv.id)}
                        >
                          Mark paid
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  )
}
