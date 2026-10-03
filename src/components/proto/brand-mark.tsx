import { BRAND_PAINT, BRAND_PATHS, type BrandVariant } from '@/core/brand-mark'

/** The Sud tizimi mark («Hukm»). Geometry lives in core/brand-mark.ts; size it with CSS or `size`. */
export function BrandMark({ variant = 'tile', size, className }: { variant?: BrandVariant; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={className} aria-hidden>
      {BRAND_PATHS.map((d, i) => (
        <path key={i} d={d} fill={BRAND_PAINT[variant][i].fill} fillOpacity={BRAND_PAINT[variant][i].opacity} />
      ))}
    </svg>
  )
}
