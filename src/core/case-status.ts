/**
 * The REAL `status_name` values of the court-case APIs (jadvalapi.sud.uz online-monitoring, read live in Nov 2026) and what they mean.
 * The old status table guessed «Иш юритувда» / «Тугатилган»: none of the real values matched it, so a status showed as raw Cyrillic and
 * a finished case with no result text counted as «in progress».
 *
 *   Кўриб чиқиш жараёнида · Тайинлаш · Рўйхатга олиш   ongoing (being heard, being scheduled, just registered)
 *   Якунланган (Ижро варақасиз | Ижро варақа билан)   finished, without / WITH a writ of execution (the case reached enforcement)
 *   Архивда                                            archived
 *   Қабул қилиш рад этилган (девонхона)                the claim was refused at the chancellery: it never became a case
 *   Фуқаро шахсий кабинетида яратилган, судга юборилмаган   a draft made in the citizen's cabinet, not sent to court
 *   Иш ҳолати номаълум                                 status unknown (old records)
 *   Иш қўзғатиш · Тайёрлаш                             ongoing (the case is being opened / prepared; seen on real rows in Nov 2026)
 * Instance statuses («Апелляцияда», «Назоратда» …) are not in this table: they say WHERE the case is, the older table handles them.
 */

export type StatusStage = 'ongoing' | 'finished' | 'archived' | 'refused' | 'draft' | 'unknown'

export interface CaseStatusInfo {
  stage: StatusStage
  /** Latin Uzbek, for display */
  label: string
  /** finished WITH a writ of execution (ijro varaqasi) */
  writ: boolean
  /** a neutral hue; the looks decide whether it is shown at all */
  color: string
}

const norm = (s: string): string => s.toLowerCase().replace(/[ʻʼ’‘`´']/g, "'").replace(/\s+/g, ' ').trim()

export function caseStatusInfo(raw: string | null | undefined): CaseStatusInfo | null {
  const s = norm(raw ?? '')
  if (!s || s === '-' || s === '—') return null
  const writ = /ижро\s*варақа\s*билан|ijro\s*varaqa\s*bilan/.test(s)
  if (/якунланган|yakunlangan/.test(s)) {
    return { stage: 'finished', writ, label: writ ? 'Yakunlangan · ijro varaqasi bilan' : 'Yakunlangan', color: '#1e7e44' }
  }
  if (/қабул\s*қилиш\s*рад|qabul\s*qilish\s*rad/.test(s)) return { stage: 'refused', writ: false, label: 'Qabul qilish rad etilgan', color: '#6b7280' }
  if (/судга\s*юборилмаган|sudga\s*yuborilmagan|шахсий\s*кабинет/.test(s)) {
    return { stage: 'draft', writ: false, label: 'Sudga yuborilmagan (fuqaro kabinetida)', color: '#6b7280' }
  }
  if (/архив|arxiv/.test(s)) return { stage: 'archived', writ: false, label: 'Arxivda', color: '#6b7280' }
  if (/номаълум|noma'lum|nomalum/.test(s)) return { stage: 'unknown', writ: false, label: 'Holati nomaʼlum', color: '#6b7280' }
  if (/тайинлаш|tayinlash/.test(s)) return { stage: 'ongoing', writ: false, label: 'Tayinlash', color: '#2563a8' }
  if (/рўйхатга\s*олиш|ro'yxatga\s*olish|royxatga\s*olish/.test(s)) return { stage: 'ongoing', writ: false, label: 'Roʻyxatga olish', color: '#2563a8' }
  if (/иш\s*қўзғатиш|ish\s*qo'zg'atish|ish\s*qozgatish/.test(s)) return { stage: 'ongoing', writ: false, label: "Ish qoʻzgʻatish", color: '#2563a8' }
  if (/тайёрлаш|tayyorlash/.test(s)) return { stage: 'ongoing', writ: false, label: 'Tayyorlash', color: '#2563a8' }
  if (/жараёнида|jarayonida/.test(s)) return { stage: 'ongoing', writ: false, label: 'Koʻrib chiqilmoqda', color: '#2563a8' }
  return null
}

/** the case is over for the purpose of «in progress» counts, whatever its result text says (or does not) */
export const isConcludedStatus = (raw: string | null | undefined): boolean => {
  const st = caseStatusInfo(raw)?.stage
  return st === 'finished' || st === 'archived' || st === 'refused'
}
