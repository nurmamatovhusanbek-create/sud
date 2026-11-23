/**
 * The courts write a hearing date as `dd.mm.yyyy`. These helpers turn it into a number that sorts and compares (`yyyymmdd`); a date is never
 * compared as a string (`'10.01.2023' < '15.12.2022'`). Uzbekistan is UTC+5 all year, so «today» is the date there.
 */

/** `15.12.2030` → 20301215; anything else → 0 */
export function hearingDateKey(s: string | null | undefined): number {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(String(s ?? '').trim())
  if (!m) return 0
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return 0
  return y * 10000 + mo * 100 + d
}

/** today's date in Uzbekistan as yyyymmdd */
export function todayKeyUz(now: number = Date.now()): number {
  const d = new Date(now + 5 * 3_600_000)
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
}
