/**
 * Client-safe types and constants for the my.sud.uz court case service.
 *
 * This file is separated from court-case.ts so that client components
 * (page.tsx) can import types and status constants without pulling in
 * the Node-only z-ai-web-dev-sdk dependency that court-case.ts uses for
 * captcha solving.
 */

export type CourtType = 'economic' | 'civil' | 'criminal' | 'administrative'
export type SearchMode = 'tin' | 'caseNumber' | 'pinfl'

export interface CourtCase {
  caseNumber: string
  caseType: string
  caseStatus: string
  result: string
  courtName: string
  dateFiled: string
  plaintiff: string
  defendant: string
  claimAmount: string
  hearingDate: string
  hearingTime: string
  judge: string
}

export interface CaseDetail {
  caseNumber: string
  caseType: string
  caseStatus: string
  court: string
  judge: string
  secretary: string
  plaintiff: string
  plaintiffTin: string
  defendant: string
  defendantTin: string
  thirdParty: string
  claimSubject: string
  claimAmount: string
  applicationDate: string
  initiatedDate: string
  deadlineDate: string
  stateDuty: string
  representative: string
  prosecutor: string
}

export interface Hearing {
  date: string
  time: string
  status: string
  postponementReason: string
  courtroom: string
  judge: string
}

export interface Decision {
  date: string
  text: string
  type: string
  awardedAmount: string
  stateDutyRecovered: string
  enforcedDate: string
  appealDeadline: string
}

export interface CaseDocument {
  name: string
  date: string
  type: string
  fileUrl: string
}

export interface InstanceData {
  hearings: Hearing[]
  decision: Decision | null
  documents: CaseDocument[]
  appellant?: string
  appealFiledDate?: string
  appellateCourt?: string
  appellateOutcome?: string
}

export interface FullCaseData {
  general: CaseDetail | null
  firstInstance: InstanceData | null
  appellate: InstanceData | null
  cassation: InstanceData | null
}

// ---- Status enums for UI ----
// IMPORTANT: the KEYS are Cyrillic Uzbek because that is what the sud.uz APIs
// (jadvalapi.sud.uz / jadval.sud.uz) return in their `status_name` / `instance`
// fields. We look up the API value against these keys, then DISPLAY the `.en`
// field (which holds the Latin-Uzbek label) — never the raw Cyrillic key.
// Latin-Uzbek keys are ALSO included so synthetic Latin status strings (e.g.
// the ones we set locally in StatsTab → CourtCase conversion) resolve too.

export const CASE_STATUSES: Record<string, { en: string; color: string }> = {
  // Cyrillic keys — match API responses
  'Иш юритувда': { en: 'Ish yurituvda', color: '#2563a8' },
  'Кўриб чиқилмоқда': { en: "Koʻrib chiqilmoqda", color: '#2563a8' },
  'Тугатилган': { en: 'Tugatilgan', color: '#1e7e44' },
  'Тўхтатилган': { en: "Toʻxtatilgan", color: '#c47d0e' },
  'Бекор қилинган': { en: 'Bekor qilingan', color: '#6b7280' },
  'Апелляцияда': { en: 'Apellyatsiyada', color: '#6d3db5' },
  'Кассацияда': { en: 'Kassatsiyada', color: '#4a1d96' },
  'Назоратда': { en: 'Nazoratda', color: '#b91c1c' },
  'Ижро этилмоқда': { en: 'Ijro etilmoqda', color: '#0e7490' },
  // Latin keys — match synthetic / Latin API responses
  'Ish yurituvda': { en: 'Ish yurituvda', color: '#2563a8' },
  "Ko'rib chiqilmoqda": { en: "Ko'rib chiqilmoqda", color: '#2563a8' },
  'Tugatilgan': { en: 'Tugatilgan', color: '#1e7e44' },
  "To'xtatilgan": { en: "To'xtatilgan", color: '#c47d0e' },
  'Bekor qilingan': { en: 'Bekor qilingan', color: '#6b7280' },
  'Apellyatsiyada': { en: 'Apellyatsiyada', color: '#6d3db5' },
  'Kassatsiyada': { en: 'Kassatsiyada', color: '#4a1d96' },
  'Nazoratda': { en: 'Nazoratda', color: '#b91c1c' },
  'Ijro etilmoqda': { en: 'Ijro etilmoqda', color: '#0e7490' },
}

export const HEARING_STATUSES: Record<string, { en: string; color: string }> = {
  // Cyrillic keys — match API responses
  'Тайинланган': { en: 'Tayinlangan', color: '#3b82f6' },
  'Кечиктирилган': { en: 'Kechiktirilgan', color: '#f59e0b' },
  'Ўтказилган': { en: "Oʻtkazilgan", color: '#10b981' },
  'Бекор қилинган': { en: 'Bekor qilingan', color: '#9ca3af' },
  'Якунланган': { en: 'Yakunlangan', color: '#1e7e44' },
  // Latin keys — match synthetic / Latin API responses
  'Tayinlangan': { en: 'Tayinlangan', color: '#3b82f6' },
  'Kechiktirilgan': { en: 'Kechiktirilgan', color: '#f59e0b' },
  "O'tkazilgan": { en: "O'tkazilgan", color: '#10b981' },
  'Bekor qilingan': { en: 'Bekor qilingan', color: '#9ca3af' },
  'Yakunlangan': { en: 'Yakunlangan', color: '#1e7e44' },
}

// `uz` is Latin-Uzbek (display). `en` is English (used as a fallback / for
// English-locale tabs). The Cyrillic forms are NOT stored here — they come
// back from the sud.uz APIs and are matched via the keys above.
export const COURT_TYPE_LABELS: Record<CourtType, { uz: string; en: string }> = {
  economic: { uz: 'Iqtisodiy sudlar', en: 'Economic Courts' },
  civil: { uz: 'Fuqarolik sudlar', en: 'Civil Courts' },
  criminal: { uz: 'Jinoyat ishlari', en: 'Criminal Courts' },
  administrative: { uz: "Maʼmuriy ishlar", en: 'Administrative Courts' },
}
