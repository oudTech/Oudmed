'use client'
import { Button, Modal } from '@/components/ui/kit'

/**
 * First-login welcome. Not a 20-step tour dumped on the user - just context and
 * a choice. "Skip for now" marks the tour skipped (resumable), it does not
 * complete it.
 */
export function WelcomeModal({
  open,
  hospitalName,
  onStart,
  onLater,
  onSkip,
}: {
  open: boolean
  hospitalName: string
  onStart: () => void
  onLater: () => void
  onSkip: () => void
}) {
  return (
    <Modal open={open} onClose={onLater} title="" width={440} align="center">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50">
          <span className="text-2xl" aria-hidden>
            👋
          </span>
        </div>
        <h2 className="text-lg font-bold text-gray-900">Welcome to {hospitalName}</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-gray-600">
          Take a two-minute tour of your workspace. We&apos;ll show you where the tools
          you use most live, and how the day&apos;s work flows from one screen to the
          next.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <Button variant="primary" onClick={onStart}>
            Start the tour
          </Button>
          <Button variant="ghost" onClick={onLater}>
            Maybe later
          </Button>
        </div>

        <button
          onClick={onSkip}
          className="mt-3 text-xs text-gray-400 underline hover:text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          Skip and don&apos;t show this again
        </button>
      </div>
    </Modal>
  )
}
