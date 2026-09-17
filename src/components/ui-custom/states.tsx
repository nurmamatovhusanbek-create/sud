'use client'

/**
 * Section state components (redesign §7.3) — every data view renders from
 * ResourceState: skeleton loading, honest empty states, error with retry,
 * and the partial banner that finally surfaces partial failures (A3).
 */

import type { ReactNode } from 'react'
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { SourceError } from '@/core/envelope'

export function EmptyState({
  title,
  hint,
  icon,
  action,
}: {
  title: string
  hint?: string
  icon?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 px-6 text-center">
      <div className="text-fg-3 [&_svg]:size-8">{icon ?? <Inbox />}</div>
      <div>
        <div className="t-h3 text-fg">{title}</div>
        {hint && <div className="mt-1 t-body-sm text-fg-3 max-w-md">{hint}</div>}
      </div>
      {action}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 p-4 rounded-[var(--radius-lg)] bg-negative-soft border border-negative-line">
      <div className="flex items-start gap-2">
        <AlertTriangle className="size-4 mt-0.5 text-negative shrink-0" />
        <div className="text-negative t-body-sm break-words">{error}</div>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="gap-2">
          <RefreshCw className="size-3.5" /> Qayta urinish
        </Button>
      )}
    </div>
  )
}

/** Non-blocking banner naming which sources failed (partial ≠ complete). */
export function PartialBanner({ errors, onRetry }: { errors: SourceError[]; onRetry?: () => void }) {
  if (!errors.length) return null
  return (
    <div className="flex items-start gap-2 p-3 rounded-[var(--radius-md)] bg-warning-soft border border-warning-line">
      <AlertTriangle className="size-4 mt-0.5 text-warning shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="t-caption-plain font-semibold text-warning">Qisman maʼlumot</div>
        <ul className="mt-0.5 space-y-0.5">
          {errors.map((e, i) => (
            <li key={i} className="t-body-sm text-[var(--status-warning-text)] break-words">
              <span className="font-medium">{e.source}</span> · {e.error}
            </li>
          ))}
        </ul>
      </div>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry} className="gap-1.5 shrink-0 text-warning">
          <RefreshCw className="size-3.5" /> Qayta
        </Button>
      )}
    </div>
  )
}

/** Skeleton shaped like the real content — table rows by default. */
export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-1">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-5 rounded-[var(--radius-sm)]" style={{ width: `${70 + ((r * 7 + c * 13) % 30)}%` }} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function KpiSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card-k p-4 space-y-2">
          <Skeleton className="h-3 w-24 rounded-full" />
          <Skeleton className="h-7 w-32 rounded-md" />
        </div>
      ))}
    </div>
  )
}
