'use client'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui/kit'
import { drugsApi, DRUG_FORMS, PACKAGING_TYPES } from '@/lib/pharmacy'

const BLANK = {
  sku: '',
  name: '',
  genericName: '',
  form: 'Tablet',
  strength: '',
  packaging: 'Pack',
  unitLabel: '',
  sellPrice: '',
  costPrice: '',
  reorderLevel: '20',
  comments: '',
  openingQty: '',
  openingExpiry: '',
  openingBatch: '',
}

export function AddDrugModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [d, setD] = useState({ ...BLANK })
  const set = (k: keyof typeof BLANK, v: string) => setD((s) => ({ ...s, [k]: v }))

  const m = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        sku: d.sku.trim() || undefined,
        name: d.name.trim(),
        genericName: d.genericName.trim() || undefined,
        form: d.form,
        strength: d.strength.trim() || undefined,
        packaging: d.packaging,
        unitLabel: d.unitLabel.trim() || undefined,
        sellPrice: Number(d.sellPrice),
        costPrice: d.costPrice ? Number(d.costPrice) : undefined,
        reorderLevel: d.reorderLevel ? Number(d.reorderLevel) : undefined,
        comments: d.comments.trim() || undefined,
      }
      if (d.openingQty && d.openingExpiry) {
        body.openingStock = {
          quantity: Number(d.openingQty),
          expiryDate: d.openingExpiry,
          batchNumber: d.openingBatch.trim() || undefined,
        }
      }
      return drugsApi.create(body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drugs'] })
      qc.invalidateQueries({ queryKey: ['drug-stats'] })
      setD({ ...BLANK })
      onClose()
    },
  })

  const valid = d.name.trim().length >= 2 && Number(d.sellPrice) >= 0 && d.sellPrice !== ''

  return (
    <Modal open={open} onClose={onClose} title="Add drug" width={620} align="center">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU">
            <Input value={d.sku} onChange={(e) => set('sku', e.target.value)} placeholder="Auto-generated if blank" />
          </Field>
          <Field label="Reorder level">
            <Input type="number" value={d.reorderLevel} onChange={(e) => set('reorderLevel', e.target.value)} />
          </Field>
        </div>
        <Field label="Item name" required>
          <Input value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Paracetamol" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Generic name">
            <Input value={d.genericName} onChange={(e) => set('genericName', e.target.value)} placeholder="INN" />
          </Field>
          <Field label="Strength / concentration">
            <Input value={d.strength} onChange={(e) => set('strength', e.target.value)} placeholder="e.g. 500 mg" />
          </Field>
          <Field label="Dosage form">
            <Select value={d.form} onChange={(e) => set('form', e.target.value)}>
              {DRUG_FORMS.map((f) => <option key={f}>{f}</option>)}
            </Select>
          </Field>
          <Field label="Packaging">
            <Select value={d.packaging} onChange={(e) => set('packaging', e.target.value)}>
              {PACKAGING_TYPES.map((p) => <option key={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="Unit of issue">
            <Input value={d.unitLabel} onChange={(e) => set('unitLabel', e.target.value)} placeholder="tablet, mL, bottle" />
          </Field>
          <div />
          <Field label="Sell price (₦)" required>
            <Input type="number" value={d.sellPrice} onChange={(e) => set('sellPrice', e.target.value)} />
          </Field>
          <Field label="Cost price (₦)">
            <Input type="number" value={d.costPrice} onChange={(e) => set('costPrice', e.target.value)} />
          </Field>
        </div>

        <div className="rounded-xl border border-gray-100 p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Opening stock (optional)</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Quantity">
              <Input type="number" value={d.openingQty} onChange={(e) => set('openingQty', e.target.value)} />
            </Field>
            <Field label="Expiry date">
              <Input type="date" value={d.openingExpiry} onChange={(e) => set('openingExpiry', e.target.value)} />
            </Field>
            <Field label="Batch no.">
              <Input value={d.openingBatch} onChange={(e) => set('openingBatch', e.target.value)} />
            </Field>
          </div>
          {d.openingQty && !d.openingExpiry && (
            <p className="text-xs text-amber-600 mt-1">An expiry date is required to add opening stock.</p>
          )}
        </div>

        <Field label="Comments">
          <Textarea rows={2} value={d.comments} onChange={(e) => set('comments', e.target.value)} />
        </Field>

        {m.isError && <p className="text-sm text-red-600">{(m.error as any)?.response?.data?.message ?? 'Could not save.'}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={m.isPending}
            disabled={!valid || (!!d.openingQty && !d.openingExpiry)}
            onClick={() => m.mutate()}
          >
            Add item
          </Button>
        </div>
      </div>
    </Modal>
  )
}
