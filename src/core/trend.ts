/**
 * Monthly case activity — the 12-month window shown on Statistika and in the
 * company report. Pure: `now` is injectable so it is testable.
 */

export const MONTHS_UZ = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']

export interface TrendPoint {
  label: string
  count: number
}

/**
 * Cases registered per month for the 12 months ending at `now`'s month (oldest
 * first). `regDate` is sud.uz's `dd.mm.yyyy`; anything else is ignored.
 */
export function monthlyTrend(cases: { regDate: string }[], now: Date = new Date()): TrendPoint[] {
  const buckets: (TrendPoint & { key: string })[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    buckets.push({ label: MONTHS_UZ[d.getMonth()], count: 0, key: `${d.getFullYear()}-${d.getMonth()}` })
  }
  for (const c of cases) {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(c.regDate)
    if (!m) continue
    const b = buckets.find((x) => x.key === `${m[3]}-${Number(m[2]) - 1}`)
    if (b) b.count++
  }
  return buckets.map(({ label, count }) => ({ label, count }))
}
