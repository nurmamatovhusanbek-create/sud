/**
 * SegmentedControl — v146 §6 extraction.
 *
 * Unified primitive for tab-btn / toggle-btn / folder-nav patterns.
 * One component, used for the main 6-tab nav, the STIR/Kvitansiya toggle,
 * and the Statistika folder-tabs.
 */
import type { ReactNode } from 'react'

interface Segment<T extends string> {
  id: T
  label: string
  icon?: ReactNode
  count?: number
}

interface SegmentedControlProps<T extends string> {
  segments: Segment<T>[]
  value: T
  onChange: (id: T) => void
  ariaLabel?: string
  className?: string
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  ariaLabel,
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <nav
      className={`liquid-rail ${className}`.trim()}
      role="tablist"
      aria-label={ariaLabel}
    >
      {segments.map((seg) => (
        <button
          key={seg.id}
          type="button"
          className={`tab-btn ${value === seg.id ? 'is-active' : ''}`}
          role="tab"
          aria-selected={value === seg.id}
          onClick={() => onChange(seg.id)}
        >
          {seg.icon}
          <span className="tab-label">{seg.label}</span>
          {seg.count !== undefined && (
            <span className="ft-count">{seg.count}</span>
          )}
        </button>
      ))}
    </nav>
  )
}
