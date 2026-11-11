/**
 * A company's cases laid out by the month they were filed, each marked with its outcome, so a glance shows when the
 * trouble started, whether it is piling up, and how the closed ones went. Pure: the view only draws what this returns.
 */

import { parseYmd } from './dates'

export type TimelineOutcome = 'win' | 'lose' | 'pending' | 'neutral' | null

export interface TimelineInput {
  id: string
  /** `dd.mm.yyyy` or ISO, as the court site sends it */
  filed?: string
  outcome: TimelineOutcome
}

export interface TimelineMonth {
  key: string
  /** «Noy» */
  label: string
  /** shown under the label on January and on the first column, so the year is never a guess */
  year: number | null
  items: { id: string; outcome: TimelineOutcome }[]
}

export interface Timeline {
  months: TimelineMonth[]
  /** filed before the window (kept in the first column's tooltip count, not dropped) */
  earlier: number
  /** no readable filing date */
  undated: number
}

const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']

/** The last `span` months ending with the current one (oldest first). Cases older than that count in `earlier`. */
export function caseTimeline(rows: readonly TimelineInput[], now: Date = new Date(), span = 18): Timeline {
  const months: TimelineMonth[] = []
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({ key: `${d.getFullYear()}-${d.getMonth() + 1}`, label: MONTHS[d.getMonth()], year: d.getMonth() === 0 || i === span - 1 ? d.getFullYear() : null, items: [] })
  }
  const byKey = new Map(months.map((m) => [m.key, m]))
  let earlier = 0
  let undated = 0
  // oldest first, so a column stacks from the bottom in filing order
  const dated = rows
    .map((r) => ({ r, p: parseYmd(r.filed) }))
    .filter((x): x is { r: TimelineInput; p: NonNullable<ReturnType<typeof parseYmd>> } => {
      if (!x.p) undated++
      return !!x.p
    })
    .sort((a, b) => a.p.y - b.p.y || a.p.m - b.p.m || a.p.d - b.p.d)
  for (const { r, p } of dated) {
    const m = byKey.get(`${p.y}-${p.m}`)
    if (m) m.items.push({ id: r.id, outcome: r.outcome })
    else if (new Date(p.y, p.m - 1, 1) < new Date(now.getFullYear(), now.getMonth() - (span - 1), 1)) earlier++
    // a filing date in the future (a typo upstream) belongs to no column and is not counted as earlier
  }
  return { months, earlier, undated }
}
