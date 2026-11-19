'use client'

/**
 * One way to show a hearing date everywhere (company list, Kuzatuv upcoming, Majlislar, Statistika «Keyingi majlis»).
 * Before, each place laid out «24 Noy 6 kun qoldi» its own way, in three type styles on one line, and it read as random text.
 *   DateTile   a small calendar leaf: month on an ink band, the day big under it; INVERTED (ink body) when the date is close.
 *   daysLabel  the countdown in words: «Bugun» / «Ertaga» / «6 kun qoldi».
 *   HearingWhen  the right-hand block of a row: time (mono) over the countdown.
 * Two colours only (premium look): closeness is told by the inverted tile and a heavier countdown, never by a hue.
 */
import { daysUntil } from '@/core/dates'
import { useLook } from '@/lib/look'

const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']
const WEEKDAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba']

/** a date within this many days is «close» (the same window as the Kuzatuv alert strip) */
export const NEAR_DAYS = 7

export interface DateParts {
  day: string
  month: string
  weekday: string
  /** whole days from today (0 = today, negative = past); null when the date can't be read */
  days: number | null
}

export function dateParts(iso: string | null | undefined): DateParts | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  return {
    day: String(d).padStart(2, '0'),
    month: MONTHS[m - 1] ?? '',
    weekday: WEEKDAYS[new Date(y, m - 1, d).getDay()],
    days: daysUntil(iso),
  }
}

export function daysLabel(days: number | null): string {
  if (days === null) return ''
  if (days < 0) return 'Oʻtib ketgan'
  if (days === 0) return 'Bugun'
  if (days === 1) return 'Ertaga'
  return `${days} kun qoldi`
}

export const isNear = (days: number | null): boolean => days !== null && days >= 0 && days <= NEAR_DAYS

export function DateTile({ iso, size = 'md', near }: { iso: string | null | undefined; size?: 'md' | 'sm'; near?: boolean }) {
  const { look } = useLook()
  const p = dateParts(iso)
  if (!p) return null
  // «Moviy»: the original date block of a datecard, a big day over the month, no tile
  if (look === 'navy') {
    return (
      <div className="dc-date">
        <div className="d">{p.day}</div>
        <div className="m">{p.month}</div>
      </div>
    )
  }
  const close = near ?? isNear(p.days)
  return (
    <span className={`dtile ${size}${close ? ' near' : ''}`} aria-hidden="true">
      <i className="dt-m">{p.month}</i>
      <b className="dt-d">{p.day}</b>
    </span>
  )
}

/** time over countdown, right-aligned: the «when» half of a hearing row */
export function HearingWhen({ iso, time }: { iso: string | null | undefined; time?: string | null }) {
  const { look } = useLook()
  const p = dateParts(iso)
  if (look === 'navy') return <div className="dc-time">{time || ''}</div>
  const label = p ? daysLabel(p.days) : ''
  return (
    <div className="dc-when">
      {time ? <div className="dc-time">{time}</div> : null}
      {label ? <div className={`dc-left${p && isNear(p.days) ? ' near' : ''}`}>{label}</div> : null}
    </div>
  )
}
