/**
 * Unified Button component — v146 §3.
 *
 * Replaces 13 ad-hoc button classes with one primitive + variants.
 * All variants share the same --r-pill radius, height scale, and motion.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

type Variant = 'primary' | 'ghost' | 'icon'
type Size = 'default' | 'sm'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: LucideIcon
  children?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'default',
  icon: Icon,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const cls = ['btn-unified']
  cls.push(`btn-unified-${variant}`)
  if (size === 'sm') cls.push('btn-unified-sm')
  if (className) cls.push(className)

  return (
    <button className={cls.join(' ')} {...props}>
      {Icon && <Icon className="btn-unified-icon" />}
      {children && <span className="btn-unified-label">{children}</span>}
    </button>
  )
}
