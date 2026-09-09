'use client'
import { useQuery } from '@tanstack/react-query'
import { claimsApi, naira } from '@/lib/claims'

export function ReceivablesTab({ onProvider }: { onProvider: (id: string) => void }) {
  const q = useQuery({ queryKey: ['claim-receivables'], queryFn: () => claimsApi.receivables() })
  const data = q.data

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        Outstanding HMO money by provider and age. Click a provider to see its claims.
      </p>
      <div className="border border-gray-100 rounded-xl overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              {['Provider', '0 to 30 days', '31 to 60', '61 to 90', 'Over 90', 'Outstanding', 'Approved unpaid', 'Rejected', 'Claims'].map((h) => (
                <th key={h} className="text-left font-medium px-3 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!data ? (
              <tr><td colSpan={9} className="px-3 py-6 text-gray-400">Loading…</td></tr>
            ) : data.rows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">No outstanding HMO receivables.</td></tr>
            ) : (
              <>
                {data.rows.map((r) => (
                  <tr
                    key={r.providerId}
                    className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                    onClick={() => onProvider(r.providerId)}
                  >
                    <td className="px-3 py-2.5 font-medium text-gray-900">{r.providerName}</td>
                    <td className="px-3 py-2.5 text-gray-600">{naira(r.aging.b0_30)}</td>
                    <td className="px-3 py-2.5 text-gray-600">{naira(r.aging.b31_60)}</td>
                    <td className="px-3 py-2.5 text-amber-700">{naira(r.aging.b61_90)}</td>
                    <td className="px-3 py-2.5 text-red-700">{naira(r.aging.b90p)}</td>
                    <td className="px-3 py-2.5 font-semibold">{naira(r.outstanding)}</td>
                    <td className="px-3 py-2.5 text-gray-500">{naira(r.approvedUnpaid)}</td>
                    <td className="px-3 py-2.5 text-gray-500">{naira(r.rejectedAmount)}</td>
                    <td className="px-3 py-2.5 text-gray-600">{r.claimCount}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-200 bg-blue-50/40 font-bold">
                  <td className="px-3 py-3">Total</td>
                  <td className="px-3 py-3">{naira(data.totals.aging.b0_30)}</td>
                  <td className="px-3 py-3">{naira(data.totals.aging.b31_60)}</td>
                  <td className="px-3 py-3">{naira(data.totals.aging.b61_90)}</td>
                  <td className="px-3 py-3">{naira(data.totals.aging.b90p)}</td>
                  <td className="px-3 py-3">{naira(data.totals.outstanding)}</td>
                  <td className="px-3 py-3">{naira(data.totals.approvedUnpaid)}</td>
                  <td className="px-3 py-3">{naira(data.totals.rejectedAmount)}</td>
                  <td className="px-3 py-3">{data.totals.claimCount}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
