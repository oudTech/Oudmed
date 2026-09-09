import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="h-full flex flex-col items-center justify-center p-8 text-center">
      <p className="text-4xl font-bold text-gray-300">404</p>
      <h1 className="text-lg font-bold text-gray-900 mt-2">Page not found</h1>
      <p className="text-sm text-gray-500 mt-1">The page you are looking for does not exist.</p>
      <Link
        href="/dashboard"
        className="mt-6 rounded-lg bg-primary text-white text-sm font-semibold px-4 py-2 hover:bg-[#2b58c9]"
      >
        Back to dashboard
      </Link>
    </div>
  )
}
