'use client'

/**
 * One look for every dropdown that sits in a filter row: the same inset field as the search box (`.f-search`), the same radius,
 * and the app's own chevron instead of the browser's (which crowds the text and differs per browser). `size="sm"` is the
 * compact one used beside page numbers. The native <select> stays underneath, so keyboard and screen readers work as before.
 */

import { ChevronDown } from 'lucide-react'

export function SelectField({
  value,
  onChange,
  ariaLabel,
  children,
  size = 'md',
  mono = false,
}: {
  value: string | number
  onChange: (value: string) => void
  ariaLabel?: string
  children: React.ReactNode
  size?: 'md' | 'tall' | 'sm'
  mono?: boolean
}) {
  return (
    <span className={`f-select${size === 'sm' ? ' sm' : size === 'tall' ? ' tall' : ''}`}>
      <select className={mono ? 'mono' : undefined} value={value} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
      <ChevronDown aria-hidden />
    </span>
  )
}
