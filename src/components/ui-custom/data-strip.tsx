/**
 * DataStrip — shared primitive for displaying a row of labeled fields.
 *
 * v145 §3: Replaces the box-in-box pattern (.money-grid/.money-cell,
 * .info-grid/.info-row) with a single bordered strip using hairline dividers.
 *
 * Design:
 *  - One outer container with border + --r-card radius
 *  - Fields are flex items with border-left hairlines (not individual boxes)
 *  - min-width: 0 on every field prevents the §7a nowrap-squeeze bug
 *  - flex-wrap + span prop handles the §7b dangling-empty-cell bug
 *
 * Usage:
 *   <DataStrip>
 *     <DataField label="Kvitansiya" icon={Wallet} value={formatSum(...)} mono />
 *     <DataField label="Toʻlangan" icon={CheckCheck} value={...} tone="paid" />
 *     <DataField label="Manzil" value={...} span />  full width
 *   </DataStrip>
 */
import type { LucideIcon } from 'lucide-react'

type Tone = 'default' | 'paid' | 'unpaid' | 'accent'

interface DataFieldProps {
  label: string
  value: string | number | null | undefined
  icon?: LucideIcon
  mono?: boolean
  tone?: Tone
  /** Span full width (starts a new row in flex-wrap) */
  span?: boolean
  /** Sub-text shown under the value (e.g. "soʻm") */
  sub?: string
}

export function DataField({
  label,
  value,
  icon: Icon,
  mono = false,
  tone = 'default',
  span = false,
  sub,
}: DataFieldProps) {
  const displayValue = value === null || value === undefined || value === ''
    ? '-'
    : String(value)

  return (
    <div
      className={`data-field tone-${tone}${span ? ' is-span' : ''}`}
    >
      <div className="data-field-label">
        {Icon && <Icon className="data-field-icon" />}
        <span>{label}</span>
      </div>
      <div className={`data-field-value${mono ? ' mono' : ''}`}>
        {displayValue}
        {sub && <span className="data-field-sub"> {sub}</span>}
      </div>
    </div>
  )
}

interface DataStripProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export function DataStrip({ children, className = '', style }: DataStripProps) {
  return (
    <div className={`data-strip ${className}`.trim()} style={style}>
      {children}
    </div>
  )
}
