'use client'
import { Button } from '@/components/ui/kit'

/**
 * A helpful empty state: says what this section is for and offers the obvious
 * next action. Use in place of a bare "No results" line on high-traffic lists.
 */
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  compact = false,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  compact?: boolean
}) {
  return (
    <div
      className={`mx-auto flex max-w-sm flex-col items-center text-center ${
        compact ? 'py-8' : 'py-16'
      }`}
    >
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-primary">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      {actionLabel && onAction && (
        <div className="mt-4">
          <Button variant="primary" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      )}
    </div>
  )
}
