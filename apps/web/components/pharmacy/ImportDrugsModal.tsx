'use client'
import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { DrugImportResultDTO } from '@oudhealth/contracts'
import { Button, Modal } from '@/components/ui/kit'
import { drugsApi, parseCsv, IMPORT_TEMPLATE } from '@/lib/pharmacy'

export function ImportDrugsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState('')
  const [result, setResult] = useState<DrugImportResultDTO | null>(null)

  const reset = () => {
    setRows([]); setFileName(''); setParseError(''); setResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const onFile = async (file: File) => {
    setParseError(''); setResult(null)
    try {
      const text = await file.text()
      const parsed = parseCsv(text)
      if (!parsed.length) throw new Error('No data rows found')
      if (!('name' in parsed[0])) throw new Error('CSV must have a "name" column')
      setRows(parsed)
      setFileName(file.name)
    } catch (e: any) {
      setParseError(e?.message ?? 'Could not read the file')
      setRows([])
    }
  }

  const m = useMutation({
    mutationFn: () => drugsApi.importDrugs(rows),
    onSuccess: (res) => {
      setResult(res)
      qc.invalidateQueries({ queryKey: ['drugs'] })
      qc.invalidateQueries({ queryKey: ['drug-stats'] })
    },
  })

  const downloadTemplate = () => {
    const blob = new Blob([IMPORT_TEMPLATE], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'drug-import-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose() }} title="Import drugs from CSV" width={560} align="center">
      <div className="space-y-3">
        <p className="text-sm text-gray-500">
          Columns: <span className="font-mono text-xs">sku, name, genericName, form, strength, packaging, unitLabel,
          sellPrice, costPrice, reorderLevel, openingQuantity, expiryDate, batchNumber</span>. Only <b>name</b> and
          <b> sellPrice</b> are required. Existing rows are matched by SKU (or name + strength) and updated.
        </p>
        <button className="text-sm font-medium text-primary hover:underline" onClick={downloadTemplate}>
          Download template
        </button>

        <div className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>Choose CSV file</Button>
          {fileName && <p className="text-xs text-gray-500 mt-2">{fileName} · {rows.length} rows</p>}
        </div>

        {parseError && <p className="text-sm text-red-600">{parseError}</p>}

        {rows.length > 0 && !result && (
          <div className="border border-gray-100 rounded-lg overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>{['name', 'strength', 'packaging', 'sellPrice', 'openingQuantity'].map((h) => (
                  <th key={h} className="text-left font-medium px-2 py-1.5">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    {['name', 'strength', 'packaging', 'sellPrice', 'openingQuantity'].map((k) => (
                      <td key={k} className="px-2 py-1.5 text-gray-700">{r[k] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 5 && <p className="text-xs text-gray-400 px-2 py-1">+{rows.length - 5} more</p>}
          </div>
        )}

        {result && (
          <div className="rounded-lg bg-gray-50 p-3 text-sm">
            <p className="text-gray-800 font-medium">
              {result.created} created · {result.updated} updated · {result.skipped} skipped
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-red-600 max-h-32 overflow-y-auto">
                {result.errors.map((e) => (
                  <li key={e.row}>Row {e.row}: {e.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { reset(); onClose() }}>
            {result ? 'Done' : 'Cancel'}
          </Button>
          {!result && (
            <Button loading={m.isPending} disabled={rows.length === 0} onClick={() => m.mutate()}>
              Import {rows.length || ''} rows
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
