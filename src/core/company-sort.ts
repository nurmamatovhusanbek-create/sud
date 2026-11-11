/**
 * Ordering of the companies table (new look: Bosh sahifa and Kuzatuv). Pure, so «unknown goes last» is tested once.
 * A value that was never read (no rating yet, bills not loaded, no hearing) is UNKNOWN, not zero: it always sorts
 * after every known value, in both directions, so a click on a column never floats a wall of dashes to the top.
 */

export type CompanySortKey = 'name' | 'rating' | 'cases' | 'winRate' | 'hearing' | 'debt'
export type SortDir = 'asc' | 'desc'

export interface CompanySortRow {
  stir: string
  name?: string
  score?: number | null
  cases?: number | null
  winRate?: number | null
  /** yyyy-mm-dd of the next hearing still ahead */
  hearingIso?: string | null
  /** overdue debt, tiyins; undefined when the bills were never loaded */
  debt?: number | null
}

/** The direction a first click on a column gives: the one a person usually wants to see first. */
export const FIRST_DIR: Record<CompanySortKey, SortDir> = {
  name: 'asc',
  rating: 'desc',
  cases: 'desc',
  winRate: 'desc',
  hearing: 'asc', // the soonest hearing first
  debt: 'desc',
}

const collator = new Intl.Collator('uz', { sensitivity: 'base', numeric: true })
/** quotes and guillemets do not decide the alphabet: «ARTEL» sorts under A */
const bare = (s: string) => s.replace(/^[\s"'«»“”‘’ʻʼ]+/, '')

function value(r: CompanySortRow, key: CompanySortKey): number | string | null {
  switch (key) {
    case 'name': return r.name && r.name.trim() ? bare(r.name) : null
    case 'rating': return r.score ?? null
    case 'cases': return r.cases ?? null
    case 'winRate': return r.winRate ?? null
    case 'hearing': return r.hearingIso || null
    case 'debt': return r.debt ?? null
  }
}

export function sortCompanies<T extends CompanySortRow>(rows: readonly T[], key: CompanySortKey, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = value(a, key)
    const y = value(b, key)
    if (x === null || y === null) {
      if (x === null && y === null) return a.stir.localeCompare(b.stir)
      return x === null ? 1 : -1 // unknown last, whatever the direction
    }
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y))
    return c !== 0 ? sign * c : a.stir.localeCompare(b.stir)
  })
}

/** A click on a column header: a new column starts in its natural direction, the same column flips. */
export function nextSort(cur: { key: CompanySortKey; dir: SortDir }, clicked: CompanySortKey): { key: CompanySortKey; dir: SortDir } {
  if (cur.key !== clicked) return { key: clicked, dir: FIRST_DIR[clicked] }
  return { key: clicked, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
}
