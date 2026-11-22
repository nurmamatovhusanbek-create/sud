/**
 * When a stored case may be trusted without asking the court again.
 *
 * A case that is over (finished / archived / refused) does not change, EXCEPT that the losing side can still file an appeal (about
 * one month after the ruling) or a cassation (about six): a new proceeding then appears under the same case number. So a finished case is
 * not frozen the day it ends. It is FROZEN (served from disk, never fetched again unless the operator presses «Yangilash») only when
 *  - its status says it is over,
 *  - no hearing is still ahead, and
 *  - the last thing that happened in it (hearing or ruling) is older than FREEZE_AFTER_DAYS (six months: the cassation window).
 * A finished case inside that window is still stored (so the last answer survives a failed fetch) but is read live when opened.
 *
 * Pure: the caller passes the dates it already has; this file knows nothing about the court's JSON.
 */

import { caseStatusInfo } from './case-status'
import { daysUntil, parseYmd } from './dates'

/** six months, the owner's rule: a case whose last event is older than this is kept as it is and not asked again (the cassation window, docs/design-notes «Instansiyalar») */
export const FREEZE_AFTER_DAYS = 183

export interface FreezeInput {
  /** the court's status text of the case (the row's or the detail's) */
  status: string | null | undefined
  /** every hearing date and ruling date known for the case, `dd.mm.yyyy` or ISO; unreadable ones are ignored */
  dates: ReadonlyArray<string | null | undefined>
}

export interface Freeze {
  /** the case is over (status finished / archived / refused) and nothing is scheduled */
  settled: boolean
  /** settled for longer than the appeal and cassation windows: serve from disk, do not ask the court */
  frozen: boolean
  /** days since the last dated event, null when there is none */
  quietDays: number | null
}

export function caseFreeze(input: FreezeInput, now: Date = new Date()): Freeze {
  const stage = caseStatusInfo(input.status)?.stage
  const over = stage === 'finished' || stage === 'archived' || stage === 'refused'
  let ahead = false
  let last: number | null = null // days since the most recent date (>= 0)
  for (const d of input.dates) {
    if (!parseYmd(d)) continue
    const until = daysUntil(d, now)
    if (until === null) continue
    if (until >= 0) ahead = true
    else last = last === null ? -until : Math.min(last, -until)
  }
  const settled = over && !ahead
  return { settled, frozen: settled && last !== null && last >= FREEZE_AFTER_DAYS, quietDays: last }
}
