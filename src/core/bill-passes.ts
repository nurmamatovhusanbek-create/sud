/**
 * When a load of a company's bills is FINISHED. billing's paging is not stable (measured Nov 2026 on a bank's 241 541 bills: the same page
 * asked twice returned different bills, and the pages of one long pass repeated some bills and skipped others), so reading the pages once is
 * not enough to say the bills are all there. A load is a series of passes; each pass uses a different page size so the page boundaries move.
 *
 *   stable pass   no bill showed up on two different pages of the pass (a bill used twice is one row per use, those repeat INSIDE a page,
 *                 and a pair split by a page boundary repeats once): billing's order held, the pass covered every row once → finished;
 *   unstable pass pages overlapped, so some bills were skipped: another pass with other page boundaries; finished when a pass finds almost
 *                 nothing new, or after the last size (the load then says it is not certain, `stable: false`).
 *
 * Pure: the numbers come from the caller.
 */

/** page sizes of the passes; billing accepts at least 10 000 a page (fewest captchas), the next ones shift the boundaries */
export const PASS_SIZES: readonly number[] = [10_000, 9_000, 8_000, 7_000, 9_500, 8_500, 7_500, 6_500]
// Every size divides by 5 (a failing page is asked as 5 smaller requests, lib/bill-cases). Eight passes: each pass reads a different slice of billing's
// unstable order, so the union converges slowly (measured: 106 171 of ~121 000 distinct bills after one and a half passes).

/** a pass is stable when fewer than this share of its rows repeat a bill of an EARLIER page of the same pass */
export const STABLE_OVERLAP = 0.005
/** a later pass that adds fewer new bills than this share of billing's row count finds nothing worth another pass */
export const NOTHING_NEW = 0.002

export interface PassCounts {
  /** rows the pass read (every page) */
  rows: number
  /** distinct bills on a page that were already on an earlier page of this pass */
  overlap: number
  /** distinct bills new to everything stored before and during this pass */
  added: number
  /** billing's own row count for the company (`totalElements`) */
  total: number
}

export interface PassVerdict {
  /** no further pass is needed */
  done: boolean
  /** the pass saw billing's order hold */
  stable: boolean
}

export function passVerdict(c: PassCounts, passIndex: number): PassVerdict {
  const stable = c.rows > 0 && c.overlap / c.rows < STABLE_OVERLAP
  if (stable) return { done: true, stable: true }
  const last = passIndex >= PASS_SIZES.length - 1
  const nothingNew = passIndex > 0 && c.total > 0 && c.added / c.total < NOTHING_NEW
  return { done: last || nothingNew, stable: false }
}

/** the page size of pass `i` (the last size repeats) */
export const passSize = (i: number): number => PASS_SIZES[Math.min(Math.max(0, i), PASS_SIZES.length - 1)]

/** which pass a page size belongs to (0 when unknown) */
export const passIndexOfSize = (size: number): number => Math.max(0, PASS_SIZES.indexOf(size))
