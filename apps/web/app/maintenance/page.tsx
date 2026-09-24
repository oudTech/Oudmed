'use client'

export default function MaintenancePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
      <div className="max-w-md text-center">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 text-primary flex items-center justify-center mx-auto mb-6">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900">Down for maintenance</h1>
        <p className="text-sm text-gray-500 mt-2">
          We&apos;re making some improvements. Your data is safe, and access will resume shortly - please check back soon.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-6 rounded-lg bg-primary text-white px-4 py-2 text-sm font-semibold hover:brightness-95 transition"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
