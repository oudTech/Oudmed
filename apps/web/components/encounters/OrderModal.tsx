'use client'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { Modal, Field, Input, Select, Textarea, Button } from '@/components/ui/kit'
import { useToast } from '@/components/ui/feedback'
import { can } from '@/lib/permissions'
import { encountersApi, ORDER_PRIORITIES } from '@/lib/encounters'

/** Order an investigation/procedure against a visit (outpatient) or an
 * admission (inpatient workspace, F1b) - whichever id is given is the
 * order's source, and its charge always follows that same source. */
export function OrderModal({
  visitId,
  admissionId,
  open,
  onClose,
}: {
  visitId?: string
  admissionId?: string
  open: boolean
  onClose: () => void
}) {
  const { data: session } = useSession()
  const toast = useToast()
  const canOverridePrice = can(session?.role, 'billing:manage')
  const [orderType, setOrderType] = useState<'LABORATORY' | 'IMAGING' | 'PROCEDURE'>('LABORATORY')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<{ id: string; name: string; unitPrice: string } | null>(null)
  const [priority, setPriority] = useState('Routine')
  const [note, setNote] = useState('')
  const [overriding, setOverriding] = useState(false)
  const [overridePrice, setOverridePrice] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const category = orderType === 'LABORATORY' ? 'Laboratory' : orderType === 'IMAGING' ? 'Imaging' : 'Procedure'

  const items = useQuery({
    queryKey: ['service-items', category, q],
    queryFn: () => encountersApi.serviceItems(category, q || undefined),
    enabled: open,
  })

  const resetOverride = () => { setOverriding(false); setOverridePrice(''); setOverrideReason('') }

  const m = useMutation({
    mutationFn: () => {
      const data = {
        orderType,
        serviceItemId: picked!.id,
        priority,
        clinicalNote: note || undefined,
        ...(overriding ? { unitPrice: Number(overridePrice) || 0, overrideReason } : {}),
      }
      return admissionId
        ? encountersApi.createAdmissionOrder(admissionId, data)
        : encountersApi.createOrder(visitId!, data)
    },
    onSuccess: () => {
      toast(`${picked?.name ?? 'Order'} placed`, 'success')
      setPicked(null); setQ(''); setNote(''); setPriority('Routine'); resetOverride()
      onClose()
    },
    onError: (err: any) => toast(err?.response?.data?.message ?? 'Could not place the order.', 'error'),
  })

  return (
    <Modal open={open} onClose={onClose} title="Order investigation" width={520} align="center">
      <div className="space-y-3">
        <Field label="Type">
          <Select value={orderType} onChange={(ev) => { setOrderType(ev.target.value as any); setPicked(null) }}>
            <option value="LABORATORY">Laboratory</option>
            <option value="IMAGING">Imaging</option>
            <option value="PROCEDURE">Procedure</option>
          </Select>
        </Field>
        <Field label="Search catalogue">
          <Input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="e.g. Full Blood Count" />
        </Field>
        <div className="border border-gray-100 rounded-lg max-h-52 overflow-y-auto divide-y">
          {(items.data ?? []).map((it) => (
            <button
              key={it.id}
              onClick={() => { setPicked({ id: it.id, name: it.name, unitPrice: it.unitPrice }); resetOverride() }}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-gray-50 ${picked?.id === it.id ? 'bg-blue-50' : ''}`}
            >
              <span>{it.name}</span>
              <span className="text-gray-400">₦{Number(it.unitPrice).toLocaleString()}</span>
            </button>
          ))}
          {items.data && items.data.length === 0 && (
            <p className="px-3 py-3 text-sm text-gray-400">No matching {category.toLowerCase()} items.</p>
          )}
        </div>
        {picked && canOverridePrice && (
          overriding ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Override price (₦)">
                <Input type="number" value={overridePrice} onChange={(ev) => setOverridePrice(ev.target.value)} />
              </Field>
              <Field label="Reason">
                <Input value={overrideReason} onChange={(ev) => setOverrideReason(ev.target.value)} placeholder="Why charge a different price?" />
              </Field>
            </div>
          ) : (
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => { setOverriding(true); setOverridePrice(picked.unitPrice) }}>
              Override price
            </button>
          )
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Priority">
            <Select value={priority} onChange={(ev) => setPriority(ev.target.value)}>
              {ORDER_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Clinical details for the lab">
          <Textarea rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Relevant history / what to look for" />
        </Field>
        {overriding && !overrideReason.trim() && (
          <p className="text-xs text-amber-600">Enter a reason for the price override before confirming.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={m.isPending}
            disabled={!picked || (overriding && !overrideReason.trim())}
            onClick={() => m.mutate()}
          >
            {picked ? `Order ${picked.name} (₦${Number(overriding ? overridePrice : picked.unitPrice).toLocaleString()})` : 'Order'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
