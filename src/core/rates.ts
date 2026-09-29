/**
 * THE win rate — one definition for every screen, chart and export.
 *
 *   win rate = won ÷ (won + lost)        (whole percent)
 *
 * Only contested outcomes count. A neutral case (qaytarilgan …) and a case still in
 * progress have produced no winner, so folding them into the denominator would punish a
 * company for cases nobody has decided. With nothing decided the rate is `null` — show «–»,
 * never a made-up 0%. Always show the base next to it («N ta hal qilingan ishdan»).
 */

/** Cases that produced a winner. */
export const contested = (win: number, lose: number): number => win + lose

/** Whole-percent win rate over contested cases, or null when none were decided. */
export function winRate(win: number, lose: number): number | null {
  const d = contested(win, lose)
  return d > 0 ? Math.round((win / d) * 100) : null
}

/** «67%» or «–» */
export const winRateText = (win: number, lose: number): string => {
  const r = winRate(win, lose)
  return r === null ? '–' : `${r}%`
}
