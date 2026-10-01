'use client'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui/kit'
import { billingApi, naira, BILLING_ITEM_TYPES } from '@/lib/billing'

export type BuilderLine = {
  key: string
  category: string
  serviceItemId?: string
  drugId?: string
  description: string
  unitPrice: number
  quantity: number
  discountPct: number
  stock: number | null
  reason?: string
}

export function AddItemModal({
  open,
  onClose,
  onAdd,
  showReason,
}: {
  open: boolean
  onClose: () => void
  onAdd: (line: BuilderLine) => void
  /** Show a reason field (item 9 addendum) - only meaningful when adding a
   * line to an EXISTING invoice, where a price override or a discount needs
   * one. Not shown when building a brand new invoice from scratch. */
  showReason?: boolean
}) {
  const [type, setType] = useState<string>('Services')
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [picked, setPicked] = useState<{ id?: string; name: string; unitPrice: number; stock: number | null } | null>(null)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [qty, setQty] = useState('1')
  const [listOpen, setListOpen] = useState(false)
  const [reason, setReason] = useState('')

  useEffect(() => {
    const tmr = setTimeout(() => setDebounced(q), 250)
    return () => clearTimeout(tmr)
  }, [q])

  const results = useQuery({
    queryKey: ['billing-catalogue', type, debounced],
    queryFn: () => billingApi.catalogue(type, debounced || undefined),
    enabled: open && type !== 'Others',
  })

  const reset = () => {
    setType('Services'); setQ(''); setPicked(null); setName(''); setPrice(''); setQty('1'); setListOpen(false); setReason('')
  }
  const close = () => { reset(); onClose() }

  const isOthers = type === 'Others'
  const effName = isOthers ? name.trim() : picked?.name ?? ''
  const effPrice = Number(price) || 0
  const effQty = Number(qty) || 0
  const amount = effPrice * effQty
  const valid = effName.length >= 2 && effPrice >= 0 && effQty >= 1
  const priceOverridden = showReason && picked != null && effPrice !== picked.unitPrice
  const reasonNeeded = showReason && priceOverridden && reason.trim().length < 3

  return (
    <Modal open={open} onClose={close} title="Add item" width={560} align="center">
      <div className="space-y-3">
        <Field label="Type">
          <Select value={type} onChange={(e) => { setType(e.target.value); setPicked(null); setQ(''); setName(''); setPrice('') }}>
            {BILLING_ITEM_TYPES.map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>

        {isOthers ? (
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item description" />
          </Field>
        ) : (
          <Field label="Name" required>
            <div className="relative">
              <Input
                value={q}
                onChange={(e) => { setQ(e.target.value); setListOpen(true); setPicked(null) }}
                onFocus={() => setListOpen(true)}
                onBlur={() => setTimeout(() => setListOpen(false), 150)}
                placeholder="Search the catalogue"
              />
              {listOpen && (results.data?.length ?? 0) > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                  {results.data!.map((it) => (
                    <button
                      key={it.id}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setPicked({ id: it.id, name: it.name, unitPrice: Number(it.unitPrice), stock: it.stock })
                        setQ(it.name)
                        setPrice(String(Number(it.unitPrice)))
                        setListOpen(false)
                      }}
                    >
                      <span>{it.name}</span>
                      <span className="text-gray-400 text-xs">
                        {naira(it.unitPrice)}{it.stock != null ? ` · ${it.stock} in stock` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Price (₦)" required>
            <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Qty" required>
            <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        </div>

        <Field label="Amount">
          <Input value={naira(amount)} disabled />
        </Field>

        {showReason && priceOverridden && (
          <Field label="Reason for overriding the catalogue price" required>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Hardship waiver approved by admin" />
          </Field>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button
            disabled={!valid || reasonNeeded}
            onClick={() => {
              onAdd({
                key: Math.random().toString(36).slice(2),
                category: type,
                serviceItemId: !isOthers && type !== 'Medication' ? picked?.id : undefined,
                drugId: type === 'Medication' ? picked?.id : undefined,
                description: effName,
                unitPrice: effPrice,
                quantity: effQty,
                discountPct: 0,
                stock: picked?.stock ?? null,
                reason: reason.trim() || undefined,
              })
              close()
            }}
          >
            Add Item
          </Button>
        </div>
      </div>
    </Modal>
  )
}
