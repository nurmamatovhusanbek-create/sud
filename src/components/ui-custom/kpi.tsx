'use client'

/**
 * KPI stat card (redesign §6.5) — the finance-reference pattern:
 * eyebrow label · big mono figure · optional ring gauge · optional delta.
 * Build on shadcn Card with full composition; tokens only.
 */

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** SVG ring gauge — mono track; fill is a status family only when the value IS a status. */
export function RingGauge({
  value,
  size = 56,
  stroke = 6,
  fill,
  children,
}: {
  /** 0..100 */
  value: number
  size?: number
  stroke?: number
  /** CSS color for the fill (a token). Defaults to the ink accent. */
  fill?: string
  children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-subtle)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={fill ?? 'var(--accent)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  )
}

export function KpiCard({
  label,
  value,
  mono = true,
  ring,
  ringFill,
  delta,
  footer,
  className,
}: {
  label: string
  value: ReactNode
  mono?: boolean
  /** Ring percentage 0..100 (optional). */
  ring?: number
  ringFill?: string
  /** Real delta only (arch guide: no invented metrics). */
  delta?: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('card-k card-k-hover p-4 flex items-center gap-4 min-w-0', className)}>
      <div className="min-w-0 flex-1">
        <div className="t-caption text-fg-3 truncate">{label}</div>
        <div className={cn('mt-1 text-[26px] leading-tight font-semibold text-fg', mono && 'mono')}>{value}</div>
        {delta && <div className="mt-0.5">{delta}</div>}
        {footer && <div className="mt-1 t-body-sm text-fg-3 truncate">{footer}</div>}
      </div>
      {ring !== undefined && (
        <RingGauge value={ring} fill={ringFill}>
          <span className="mono t-caption-plain font-semibold text-fg-2">{Math.round(ring)}</span>
        </RingGauge>
      )}
    </div>
  )
}
