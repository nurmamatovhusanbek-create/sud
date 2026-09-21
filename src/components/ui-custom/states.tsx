'use client'

/**
 * Section state components — every data view renders from ResourceState:
 * skeleton loading, honest empty states, error with retry, and the partial
 * banner that surfaces partial source failures.
 *
 * These are expressed in the prototype.css class system (.empty, .alert.err,
 * .alert.warn, .btn) so they match the rest of the app (the bell popover's
 * empty state, the section banners) instead of a parallel Tailwind idiom.
 */

import type { ReactNode } from 'react'
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'
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
    <div className="empty">
      <div className="ico">{icon ?? <Inbox />}</div>
      <h3>{title}</h3>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="alert err">
      <AlertTriangle />
      <div className="at">
        <b>Xatolik</b>
        <p>{error}</p>
        {onRetry && (
          <button className="btn btn-sm btn-outline" style={{ marginTop: 10 }} onClick={onRetry}>
            <RefreshCw /> Qayta urinish
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Non-blocking, on-system strip naming which sources failed (partial ≠
 * complete). Slim neutral chrome; the warning reads only through the icon
 * color. Full per-source detail stays available on hover (title).
 */
export function PartialBanner({ errors, onRetry }: { errors: SourceError[]; onRetry?: () => void }) {
  if (!errors.length) return null
  const sources = errors.map((e) => e.source).join(', ')
  return (
    <div className="partial-strip" title={errors.map((e) => `${e.source}: ${e.error}`).join('\n')}>
      <AlertTriangle />
      <span className="ptxt">
        <b>Qisman maʼlumot</b> — {sources} ulanib boʻlmadi
      </span>
      {onRetry && (
        <button className="pretry" onClick={onRetry}>
          <RefreshCw /> Qayta
        </button>
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
