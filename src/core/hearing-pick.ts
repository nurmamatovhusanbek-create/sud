/**
 * Which hearing a case row should show.
 *
 * jadvalapi rows carry the FIRST-instance hearing at the top level and one nested
 * entry per review in `reviews[]` (appeal, cassation), each with its own
 * `hearing_date` / `hearing_time` / `responsible` / `court`. A case that went to
 * appeal keeps its old first-instance date at the top, so reading only the top
 * level made an appeal hearing set for today invisible to «upcoming hearings».
 *
 * Rule: the earliest hearing that is today or later, wherever it sits; when none
 * is ahead, the most recent past one. Ties keep the top level first.
 */

import { dateKey, daysUntil, formatDmy, parseYmd } from './dates'

export type HearingStage = 'first' | 'appeal' | 'cassation'

export interface PickedHearing {
  /** `dd.mm.yyyy`, the app's contract */
  date: string
  time: string
  judge: string
  /** the court that holds THIS hearing (the appeal court differs from the first one) */
  court: string
  stage: HearingStage
}

type Raw = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** `instance` is Cyrillic-Uzbek («Апелляция инстанцияси»); Latin spellings match too. */
export function stageOfInstance(instance: unknown): HearingStage {
  const s = str(instance).toLowerCase()
  if (/касс|kass/.test(s)) return 'cassation'
  if (/апел|apel|appel/.test(s)) return 'appeal'
  return 'first'
}

function candidate(raw: Raw, stage: HearingStage): PickedHearing | null {
  const p = parseYmd(str(raw.hearing_date))
  if (!p) return null
  // the time sometimes rides on the date («05.10.2026 10:30»)
  const inline = /\b(\d{1,2}:\d{2})/.exec(str(raw.hearing_date))?.[1] ?? ''
  return {
    date: formatDmy(new Date(p.y, p.m - 1, p.d)),
    time: str(raw.hearing_time) || inline,
    judge: str(raw.responsible),
    court: str(raw.court),
    stage,
  }
}

export function pickHearing(raw: Raw, now: Date = new Date()): PickedHearing | null {
  const found: PickedHearing[] = []
  const top = candidate(raw, stageOfInstance(raw.instance))
  if (top) found.push(top)
  const reviews = Array.isArray(raw.reviews) ? raw.reviews : []
  for (const r of reviews) {
    if (!r || typeof r !== 'object') continue
    const c = candidate(r as Raw, stageOfInstance((r as Raw).instance))
    if (c) found.push(c)
  }
  if (!found.length) return null

  const key = (h: PickedHearing) => `${dateKey(h.date)} ${(h.time || '00:00').padStart(5, '0')}`
  const ahead = found.filter((h) => (daysUntil(h.date, now) ?? -1) >= 0)
  if (ahead.length) return ahead.reduce((a, b) => (key(b) < key(a) ? b : a))
  return found.reduce((a, b) => (key(b) > key(a) ? b : a))
}
