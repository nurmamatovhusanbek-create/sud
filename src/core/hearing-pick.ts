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

export type HearingStage = 'first' | 'appeal' | 'cassation' | 'inspection'

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

/**
 * `instance` is Cyrillic-Uzbek («Апелляция инстанцияси»); Latin spellings and the library's enum names match too.
 * The fourth instance is «Taftish» (the site's INSPECTION; Cyrillic «Тафтиш», and the case status calls it «Назорат»: supervision).
 */
export function stageOfInstance(instance: unknown): HearingStage {
  const s = str(instance).toLowerCase()
  if (/тафтиш|назорат|надзор|taftish|nazorat|inspect|supervis/.test(s)) return 'inspection'
  if (/касс|kass|cass/.test(s)) return 'cassation'
  if (/апел|apel|appel|appeal/.test(s)) return 'appeal'
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

const RANK: Record<HearingStage, number> = { first: 0, appeal: 1, cassation: 2, inspection: 3 }

export interface CurrentInstance {
  stage: HearingStage
  /** THIS instance's judge ('' when the court has not named one yet): never the first instance's judge */
  judge: string
  court: string
}

/**
 * The instance a case is in NOW: the most advanced one that has a record (cassation, else appeal, else first).
 * jadvalapi keeps the FIRST-instance court and judge at the top level and each review's own in `reviews[]`, and the
 * judge changes with every instance, so a case in appeal showed its first-instance judge. A review that has no judge
 * yet gives '' (the UI shows «-») rather than borrowing the first one's name.
 */
export function currentInstance(raw: Raw): CurrentInstance {
  let best: { stage: HearingStage; src: Raw } = { stage: stageOfRow(raw), src: raw }
  for (const stage of ['appeal', 'cassation', 'inspection'] as const) {
    const r = reviewOf(raw, stage)
    if (r && RANK[stage] > RANK[best.stage]) best = { stage, src: r }
  }
  return { stage: best.stage, judge: str(best.src.responsible), court: str(best.src.court) || (best.stage === 'first' ? '' : str(raw.court)) }
}

/** The review entry of one instance. A case can have several of the same kind (a repeated cassation): the one with the latest date wins. */
export function reviewOf(raw: Raw, stage: Exclude<HearingStage, 'first'>): Raw | null {
  const reviews = Array.isArray(raw.reviews) ? raw.reviews : []
  const key = (r: Raw) => dateKey(str(r.hearing_date) || str(r.reg_date)) || ''
  let best: Raw | null = null
  for (const r of reviews) {
    if (!r || typeof r !== 'object' || stageOfInstance((r as Raw).instance) !== stage) continue
    if (!best || key(r as Raw) > key(best)) best = r as Raw
  }
  return best
}

/**
 * The instance a ROW itself is in. A row from jadval.sud.uz may be a review of its own (its `instance` says «Апелляция…») rather than the
 * first-instance row with `reviews[]` inside; its judge and court then belong to that instance, not to the first one.
 */
export function stageOfRow(raw: Raw): HearingStage {
  return stageOfInstance(raw.instance)
}

/** EVERY review entry of one instance, oldest first (appeals, a cassation and its repeat, earlier first-instance proceedings…). */
export function reviewsOf(raw: Raw, stage: HearingStage): Raw[] {
  const reviews = Array.isArray(raw.reviews) ? raw.reviews : []
  const key = (r: Raw) => dateKey(str(r.hearing_date) || str(r.reg_date)) || ''
  return reviews
    .filter((r): r is Raw => !!r && typeof r === 'object' && stageOfInstance((r as Raw).instance) === stage)
    .sort((a, b) => key(a).localeCompare(key(b)))
}
