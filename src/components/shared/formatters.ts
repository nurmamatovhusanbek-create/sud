/**
 * Shared formatters — v150 P2 extraction from page.tsx.
 * These are used by multiple tabs and donʼt depend on any server-only code.
 */

export function formatSum(t: number | null | undefined): string {
  if (t == null || isNaN(t)) return '-'
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(t / 100)
}

export function formatTin(tin: string): string {
  if (!tin) return ''
  return tin.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')
}

export function formatDate(ts: number | null | undefined): string {
  if (ts == null || isNaN(ts)) return '-'
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function parseCaseDate(s: string | null | undefined): number {
  if (!s) return 0
  // Try DD.MM.YYYY format
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/)
  if (m) {
    return new Date(+m[3], +m[2] - 1, +m[1]).getTime()
  }
  const t = Date.parse(s)
  return isNaN(t) ? 0 : t
}

export function instanceLabel(s: string | null | undefined): string {
  if (!s) return ''
  if (s === 'first') return 'birinchi instansiya'
  if (s === 'appellate') return 'apellyatsiya'
  if (s === 'cassation') return 'kassatsiya'
  return s
}

export function ratingLabel(type: string): string {
  if (['AAA', 'AA', 'A'].includes(type)) return 'Yuqori'
  if (['BBB', 'BB', 'B'].includes(type)) return "Oʻrta"
  if (['CCC', 'CC', 'C'].includes(type)) return 'Qoniqarli'
  if (type === 'D') return 'Quyi'
  return "Nomaʼlum"
}
