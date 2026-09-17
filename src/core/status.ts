/**
 * Status → family mapping (redesign guide §4.3) — the pure brain behind the
 * one `StatusBadge` component. Color is SIGNAL; this file decides which signal
 * each domain status maps to. The UI renders `family` via CSS tokens only.
 *
 * Do not change domain logic here — this is a lookup, not classification.
 */

export type StatusFamily = 'positive' | 'negative' | 'warning' | 'info' | 'neutral'

// ---- Bills (billing.sud.uz invoice statuses) ----------------------------

export type BillStatusKey =
  | 'PAID'
  | 'USED'
  | 'CREATED'
  | 'PARTIALLY_PAID'
  | 'CHECKING'
  | 'SENT_TO_MIB'
  | 'CANCELLED'
  | (string & {})

export function billStatusFamily(status: string | null | undefined, overdueAmount: number = 0): StatusFamily {
  const s = (status || '').toUpperCase()
  if (s === 'PAID' || s === 'USED') return 'positive'
  if (s === 'CANCELLED') return 'negative'
  if (s === 'PARTIALLY_PAID' || s === 'CHECKING' || s === 'SENT_TO_MIB') return 'warning'
  if (s === 'CREATED') return overdueAmount > 0 ? 'negative' : 'neutral'
  return 'neutral'
}

// ---- Case results -------------------------------------------------------

export type CaseClassification = 'win' | 'lose' | 'pending' | 'neutral'

export function caseClassificationFamily(c: CaseClassification): StatusFamily {
  switch (c) {
    case 'win': return 'positive'
    case 'lose': return 'negative'
    case 'pending': return 'warning'
    default: return 'neutral'
  }
}

// ---- Hearings ------------------------------------------------------------

export function hearingStatusFamily(status: string | null | undefined, daysUntil?: number | null): StatusFamily {
  const s = (status || '').toLowerCase()
  // Keys mirror HEARING_STATUSES in court-case-types.ts (Cyrillic + Latin).
  // negative: postponed / cancelled
  if (
    s.includes('кечиктир') || s.includes('kechiktirilgan') ||
    s.includes('отлож') || s.includes('qoldirilgan') || s.includes('қолдирилган') ||
    s.includes('бекор') || s.includes('bekor') || s.includes('отмен')
  ) {
    return 'negative'
  }
  // neutral: held / finished
  if (
    s.includes('ўтказилган') || s.includes("o'tkazilgan") || s.includes('провед') ||
    s.includes('якунланган') || s.includes('yakunlangan') || s.includes('решени')
  ) {
    return 'neutral'
  }
  if (daysUntil !== null && daysUntil !== undefined && daysUntil <= 7) return 'warning'
  return 'info'
}

// ---- Company status ------------------------------------------------------

export function companyStatusFamily(status: string | null | undefined): StatusFamily {
  const s = (status || '').toLowerCase()
  if (!s) return 'neutral'
  // "ҳозирда мавжуд" (orginfo) means the entity currently exists → active
  if (s.includes('фаол') || s.includes('faol') || s.includes('active') || s.includes('дейст') || s.includes('мавжуд') || s.includes('mavjud')) return 'positive'
  if (s.includes('тугат') || s.includes('tugat') || s.includes('liquidat')) return 'negative'
  if (s.includes('мулақ') || s.includes('mulaqa') || s.includes('suspend')) return 'warning'
  return 'neutral'
}

// ---- Contractor rating bands (chamber.uz AAA–D) ---------------------------

export function ratingBandFamily(rating: string | null | undefined): StatusFamily | null {
  if (!rating) return null
  const r = rating.toUpperCase()
  if (/^(AAA|AA|A)$/.test(r)) return 'positive'
  if (/^(BBB|BB|B)$/.test(r)) return 'warning'
  if (/^(CCC|CC|C|D)$/.test(r)) return 'negative'
  return null
}

// ---- Worker / source health ------------------------------------------------

export type HealthState = 'healthy' | 'degraded' | 'dead' | 'unknown'

export function healthFamily(state: HealthState): StatusFamily {
  switch (state) {
    case 'healthy': return 'positive'
    case 'degraded': return 'warning'
    case 'dead': return 'negative'
    default: return 'neutral'
  }
}
