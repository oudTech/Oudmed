import Link from 'next/link'

export default function RootNotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center font-hanken bg-white">
      <p className="text-4xl font-bold text-gray-300">404</p>
      <h1 className="text-lg font-bold text-gray-900 mt-2">Page not found</h1>
      <Link href="/" className="mt-6 text-sm font-medium text-primary hover:underline">
        Go home
      </Link>
    </div>
  )
}
