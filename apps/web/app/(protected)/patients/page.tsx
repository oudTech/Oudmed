'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { patientsApi, patientName, PATIENT_STATUS_META, titleCase } from '@/lib/patients'
import { can } from '@/lib/permissions'
import { QuickAddModal } from '@/components/patients/QuickAddModal'
import { EmptyState } from '@/components/onboarding'

const FILTERS = [
  { v: 'all', l: 'All' },
  { v: 'active', l: 'Active patients' },
  { v: 'inpatient', l: 'Inpatients' },
  { v: 'emergency', l: 'Emergency cases' },
  { v: 'hmo', l: 'HMO patients' },
  { v: 'incomplete', l: 'Incomplete' },
]

function dateShort(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('en-GB') : '-'
}

export default function PatientsPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const allowed = can(session?.role, 'patient:read')

  const [filter, setFilter] = useState('all')
  const [gender, setGender] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [quickAdd, setQuickAdd] = useState(false)

  const stats = useQuery({ queryKey: ['patient-stats'], queryFn: patientsApi.stats, enabled: allowed })
  const list = useQuery({
    queryKey: ['patients', filter, gender, search, page],
    queryFn: () => patientsApi.list({ filter, gender: gender || undefined, search: search || undefined, page }),
    enabled: allowed,
  })

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1

  if (!allowed) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Patients</h1>
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6">
          Patient records are available to clinical and front-desk staff.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="px-8 pt-7 pb-4 flex items-center justify-between flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-900">Patients</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setQuickAdd(true)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Quick add
          </button>
          <Link
            href="/patients/new"
            data-tour="patients-add"
            className="flex items-center gap-2 bg-primary text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#2b58c9]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add new patient
          </Link>
        </div>
      </div>
      <div className="border-b border-[#D6DEE8] flex-shrink-0" />

      <div className="flex-1 overflow-auto px-8 py-5">
        {/* stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
          <StatCard label="Active Patient" stat={stats.data?.activePatients} />
          <StatCard label="Inpatient" stat={stats.data?.inpatients} />
          <StatCard label="Emergency cases" stat={stats.data?.emergencyCases} />
          <StatCard label="HMO Patient" stat={stats.data?.hmoPatients} />
        </div>

        {/* filters */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div data-tour="patients-search" className="relative flex-1 min-w-[220px] max-w-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" strokeLinecap="round" />
            </svg>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search name, patient, HMO number"
              className="w-full border border-gray-200 rounded-full pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          {FILTERS.map((f) => (
            <button
              key={f.v}
              onClick={() => {
                setFilter(f.v)
                setPage(1)
              }}
              className={`px-3 py-1.5 rounded-full text-sm border transition ${
                filter === f.v
                  ? 'bg-blue-50 border-primary text-primary font-medium'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {f.l}
            </button>
          ))}
          <select
            value={gender}
            onChange={(e) => {
              setGender(e.target.value)
              setPage(1)
            }}
            className="px-3 py-1.5 rounded-full text-sm border border-gray-200 text-gray-500 bg-white"
          >
            <option value="">Gender</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
        </div>

        {/* table */}
        <div className="border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                {['Full name', 'ID number', 'Age', 'Gender', 'Phone', 'Assigned Doctor', 'Last visit', 'Status'].map((h) => (
                  <th key={h} className="text-left font-medium px-4 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    Loading…
                  </td>
                </tr>
              )}
              {list.data?.patients.map((p) => {
                const meta = PATIENT_STATUS_META[p.status]
                return (
                  <tr
                    key={p.id}
                    onClick={() => router.push(`/patients/${p.id}`)}
                    className="border-t border-gray-100 hover:bg-blue-50/30 cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 text-xs font-semibold flex items-center justify-center flex-shrink-0">
                          {p.firstName[0]}
                          {p.lastName[0]}
                        </span>
                        <span className="font-medium text-gray-900">{patientName(p)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{p.patientNumber}</td>
                    <td className="px-4 py-3 text-gray-600">{p.age ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{p.gender ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{p.phone ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{p.assignedDoctor?.fullName ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{dateShort(p.lastVisitAt)}</td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{ color: meta.color, backgroundColor: meta.bg }}
                      >
                        {meta.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {list.data?.patients.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4">
                    {search || filter !== 'all' || gender ? (
                      <EmptyState
                        compact
                        title="No patients match your search"
                        description="Try a different name or ID, or clear the filters to see everyone."
                        actionLabel="Clear filters"
                        onAction={() => {
                          setSearch('')
                          setFilter('all')
                          setGender('')
                          setPage(1)
                        }}
                      />
                    ) : (
                      <EmptyState
                        compact
                        title="No patients yet"
                        description="Register your first patient to start booking appointments and consultations."
                        actionLabel="Add new patient"
                        onAction={() => router.push('/patients/new')}
                      />
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
            <span>
              {list.data?.total} patients · page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="border border-gray-200 rounded-lg px-3 py-1 disabled:opacity-40 hover:bg-gray-50"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="border border-gray-200 rounded-lg px-3 py-1 disabled:opacity-40 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <QuickAddModal open={quickAdd} onClose={() => setQuickAdd(false)} />
    </div>
  )
}

function StatCard({
  label,
  stat,
}: {
  label: string
  stat?: { total: number; addedThisMonth: number }
}) {
  return (
    <div className="border border-gray-100 rounded-xl px-4 py-3">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-0.5">{stat?.total ?? '-'}</p>
      <p className="text-xs text-green-600 mt-0.5">
        +{stat?.addedThisMonth ?? 0} added this month
      </p>
    </div>
  )
}
