/**
 * The portfolio figures on the green look's «Bugun» page. Pure: the registry's cached meta goes in, a number or a word
 * comes out (no React, no DOM), so they are tested without a browser.
 */

export interface WinInput {
  cases?: number
  winRate?: number
}

/** The win rate over ALL the companies, weighted by their case counts (a company with 3 cases must not count like one with 300). null when nothing is known. */
export function weightedWinRate(list: WinInput[]): number | null {
  let won = 0
  let total = 0
  for (const c of list) {
    if (typeof c.winRate !== 'number' || !Number.isFinite(c.winRate) || !c.cases || c.cases <= 0) continue
    won += (c.cases * c.winRate) / 100
    total += c.cases
  }
  return total > 0 ? Math.round((won / total) * 100) : null
}

/** A word for a win rate (the portfolio line). */
export function winLabel(rate: number | null): string {
  if (rate === null) return 'Maʼlumot yoʻq'
  if (rate >= 75) return 'Aʼlo'
  if (rate >= 55) return 'Yaxshi'
  if (rate >= 35) return 'Oʻrtacha'
  return 'Past'
}
