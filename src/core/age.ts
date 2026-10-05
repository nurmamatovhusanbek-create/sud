/**
 * «How old is this data» in the app's Uzbek, for the snapshot age label.
 * Pure: the caller passes both times (ms epoch).
 */

export function ageLabel(fetchedAt: number, now: number): string {
  const min = Math.floor(Math.max(0, now - fetchedAt) / 60_000)
  if (min < 1) return 'hozirgina'
  if (min < 60) return `${min} daqiqa oldin`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} soat oldin`
  return `${Math.floor(h / 24)} kun oldin`
}
