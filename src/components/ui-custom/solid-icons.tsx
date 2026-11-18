/**
 * Solid (filled) icons for the places where an icon must be read at a glance: the big half-corner icon of a stat tile and the
 * status icon of a case row. One BOLD family only: Remix Icon «fill» (Apache-2.0, © Remix Design, https://remixicon.com), vendored
 * here as path data (no dependency, nothing loaded at run time). Phosphor fill and thin outlines were tried and rejected as too light.
 * The thin outline icons of lucide stay for small controls; they do NOT mix with these on the same element.
 * To add an icon: copy its body from the «ri» Iconify set (all are 24x24).
 */

const PATHS = {
  'gavel': ['M14.005 20.003v2h-12v-2zM14.59.689l7.778 7.778l-1.414 1.414l-1.061-.353l-2.475 2.475l5.657 5.657l-1.414 1.414l-5.657-5.657l-2.404 2.404l.283 1.132l-1.415 1.414l-7.778-7.778l1.414-1.415l1.132.283l6.293-6.293l-.353-1.06z'],
  'trophy': ['M13.005 16.94v2.063h5v2h-12v-2h5V16.94a8 8 0 0 1-7-7.938v-6h16v6a8 8 0 0 1-7 7.938m-12-11.937h2v4h-2zm20 0h2v4h-2z'],
  'calendar-blank': ['M2 11h20v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1zm15-8h4a1 1 0 0 1 1 1v5H2V4a1 1 0 0 1 1-1h4V1h2v2h6V1h2z'],
  'wallet': ['M22.005 6h-7a6 6 0 0 0 0 12h7v2a1 1 0 0 1-1 1h-18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1zm-7 2h8v8h-8a4 4 0 1 1 0-8m0 3v2h3v-2z'],
  'users': ['M2 22a8 8 0 1 1 16 0zm8-9c-3.315 0-6-2.685-6-6s2.685-6 6-6s6 2.685 6 6s-2.685 6-6 6m7.363 2.233A7.505 7.505 0 0 1 22.983 22H20c0-2.61-1-4.986-2.637-6.767m-2.023-2.276A7.98 7.98 0 0 0 18 7a7.96 7.96 0 0 0-1.015-3.903A5 5 0 0 1 21 8a5 5 0 0 1-5.66 4.957'],
  'receipt': ['M20 22H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1M8 9v2h8V9zm0 4v2h8v-2z'],
  'timer': ['m17.618 5.968l1.453-1.453l1.414 1.414l-1.453 1.453A9 9 0 1 1 12 4c2.125 0 4.078.736 5.618 1.968M11 8v6h2V8zM8 1h8v2H8z'],
  'check-circle': ['M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10m5.457-12.543L11 15.914l-4.207-4.207l1.414-1.414L11 13.086l5.043-5.043z'],
  'x-circle': ['M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10s-4.477 10-10 10m0-11.414L9.172 7.757L7.757 9.172L10.586 12l-2.829 2.828l1.415 1.415L12 13.414l2.828 2.829l1.415-1.415L13.414 12l2.829-2.828l-1.415-1.415z'],
  'arrow-u-up-left': ['M8 7v4L2 6l6-5v4h5a8 8 0 1 1 0 16H4v-2h9a6 6 0 0 0 0-12z'],
  'hourglass-medium': ['M6 4H4V2h16v2h-2v2c0 1.615-.816 2.915-1.844 3.977c-.703.726-1.558 1.395-2.425 2.023c.867.628 1.722 1.297 2.425 2.023C17.184 15.085 18 16.385 18 18v2h2v2H4v-2h2v-2c0-1.615.816-2.915 1.844-3.977c.703-.726 1.558-1.395 2.425-2.023c-.867-.628-1.722-1.297-2.425-2.023C6.816 8.915 6 7.615 6 6zm2 0v2c0 .685.26 1.335.771 2h6.458c.51-.665.771-1.315.771-2V4zm4 9.222c-1.045.738-1.992 1.441-2.719 2.192a7 7 0 0 0-.51.586h6.458a7 7 0 0 0-.51-.586c-.727-.751-1.674-1.454-2.719-2.192'],
  'circle': ['M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10'],
} as const

export type SolidName = keyof typeof PATHS

export function SolidIcon({ name, size, className }: { name: SolidName; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" className={className} focusable="false" data-ico={name}>
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}

export type StatusFamilyKey = 'win' | 'lose' | 'neutral' | 'pending' | 'unknown'

const STATUS_ICON: Record<StatusFamilyKey, SolidName> = {
  win: 'check-circle',
  lose: 'x-circle',
  neutral: 'arrow-u-up-left',
  pending: 'hourglass-medium',
  unknown: 'circle',
}

/** The icon of a case status: granted / rejected / returned or otherwise closed / still being heard. Always ink: the shape says it, not a colour. */
export function StatusIcon({ family, size = 24, className }: { family: StatusFamilyKey; size?: number; className?: string }) {
  return <SolidIcon name={STATUS_ICON[family]} size={size} className={className} />
}

/** One shared gradient for the big tile icons (mounted once by the shell; the stops read the look's --ico-a / --ico-b tokens). */
export function IconGradientDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="sud-ico-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--ico-a, currentColor)' }} />
          <stop offset="1" style={{ stopColor: 'var(--ico-b, currentColor)' }} />
        </linearGradient>
      </defs>
    </svg>
  )
}
