'use client'

/**
 * The status vocabulary (redesign §4, §6.6) — ONE badge component + a dot +
 * a delta, driven by the pure family mappings in src/core/status.ts.
 *
 * A resting badge = -soft bg + -text + -line border. `solid` is reserved for
 * the single most important state in a view. Color is never the only signal:
 * badges carry a WORD, dots sit next to a label, and callers may add icons.
 */

import { cn } from '@/lib/utils'
import type { StatusFamily } from '@/core/status'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'

const FAMILY: Record<StatusFamily, { soft: string; text: string; line: string; solid: string; on: string; base: string }> = {
  positive: {
    soft: 'bg-positive-soft text-positive border-positive-line',
    text: 'text-positive',
    line: 'border-positive-line',
    solid: 'bg-positive-solid text-[var(--status-positive-on)]',
    on: 'text-[var(--status-positive-on)]',
    base: 'bg-positive-solid',
  },
  negative: {
    soft: 'bg-negative-soft text-negative border-negative-line',
    text: 'text-negative',
    line: 'border-negative-line',
    solid: 'bg-negative-solid text-[var(--status-negative-on)]',
    on: 'text-[var(--status-negative-on)]',
    base: 'bg-negative-solid',
  },
  warning: {
    soft: 'bg-warning-soft text-warning border-warning-line',
    text: 'text-warning',
    line: 'border-warning-line',
    solid: 'bg-warning-solid text-[var(--status-warning-on)]',
    on: 'text-[var(--status-warning-on)]',
    base: 'bg-warning-solid',
  },
  info: {
    soft: 'bg-info-soft text-info border-info-line',
    text: 'text-info',
    line: 'border-info-line',
    solid: 'bg-info-solid text-[var(--status-info-on)]',
    on: 'text-[var(--status-info-on)]',
    base: 'bg-info-solid',
  },
  neutral: {
    soft: 'bg-[var(--status-neutral-soft)] text-[var(--status-neutral-text)] border-[var(--status-neutral-line)]',
    text: 'text-[var(--status-neutral-text)]',
    line: 'border-[var(--status-neutral-line)]',
    solid: 'bg-[var(--status-neutral-solid)] text-[var(--status-neutral-on)]',
    on: 'text-[var(--status-neutral-on)]',
    base: 'bg-[var(--status-neutral-base)]',
  },
}

export function StatusBadge({
  family,
  label,
  solid = false,
  className,
  title,
}: {
  family: StatusFamily
  label: string
  solid?: boolean
  className?: string
  title?: string
}) {
  const f = FAMILY[family]
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-0.5 t-caption-plain whitespace-nowrap',
        solid ? f.solid : f.soft,
        className,
      )}
    >
      {label}
    </span>
  )
}

export function StatusDot({ family, className }: { family: StatusFamily; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 rounded-full shrink-0', FAMILY[family].base, className)}
    />
  )
}

/** Signed micro-figure: ▲ +N (positive) / ▼ −N (negative). Never invented — only rendered when a real prior exists. */
export function Delta({
  value,
  invert = false,
  className,
}: {
  /** Positive/negative number; null renders nothing. */
  value: number | null | undefined
  /** When a decrease is good (e.g. overdue), pass invert. */
  invert?: boolean
  className?: string
}) {
  if (value === null || value === undefined || value === 0) return null
  const up = value > 0
  const good = invert ? !up : up
  const family: StatusFamily = good ? 'positive' : 'negative'
  return (
    <span className={cn('inline-flex items-center gap-0.5 t-caption-plain font-semibold', FAMILY[family].text, className)}>
      {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {up ? '+' : '−'}
      {Math.abs(value)}
    </span>
  )
}

export { FAMILY as STATUS_FAMILY_CLASSES }
