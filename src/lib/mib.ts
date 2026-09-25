/**
 * mib.uz result parser (server-side, pure — no network).
 *
 * The operator runs the fast «Qarzdorlikni tekshirish» service on mib.uz in
 * their own browser (a UZ IP, so no geo-block; captcha solved by them, no
 * phone/SMS) and brings the result page back; this parses the «Ижро иши
 * рақами» blocks into structured debts.
 *
 * Isolated to text extraction (regex over tag-stripped text); the HTML is never
 * rendered. Verified against the documented mib.uz field layout, not a live
 * fetch (mib.uz is unreachable from non-UZ IPs).
 */

import type { MibDebt, MibDebtResult } from './mib-types'

// Known labels in the mib.uz debt-check result (Uzbek Cyrillic). Used both to
// find values and as right-boundaries when a value itself contains spaces.
const LABELS = [
  'Ижро иши рақами',
  'Ҳужжат ҳолати',
  'И/Ҳ мазмуни',
  'Ҳужжат иш юритувида',
  'Ундирувчи',
  'Қарздорлик миқдори',
  'Бўлим',
  'Умумий қарздорлик',
  'Жорий қарздорлик',
]

function stripTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
}

function normalize(html: string): string {
  return decodeEntities(stripTags(html)).replace(/\s+/g, ' ').trim()
}

/** Parse an Uzbek amount ("20 600.00" · "10 210 467,75") → number. */
function parseAmount(s: string): number {
  let c = s.replace(/[^\d.,]/g, '')
  if (c.includes(',') && c.includes('.')) c = c.replace(/,/g, '') // , thousands, . decimal
  else c = c.replace(',', '.')
  const n = parseFloat(c)
  return Number.isNaN(n) ? 0 : n
}

/** Value that follows `label` in `text`, up to the next known label. */
function fieldAfter(text: string, label: string, extraStops: string[] = []): string | undefined {
  const i = text.indexOf(label)
  if (i < 0) return undefined
  const rest = text.slice(i + label.length)
  let end = rest.length
  for (const l of [...LABELS, ...extraStops]) {
    if (l === label) continue
    const j = rest.indexOf(l)
    if (j >= 0 && j < end) end = j
  }
  const v = rest.slice(0, end).replace(/^[\s:.–—-]+/, '').trim()
  return v || undefined
}

export function parseMibHtml(html: string, tin: string): MibDebtResult {
  const text = normalize(html)
  const clean = (tin || '').trim()
  const base = { tin: clean, checkedAt: Date.now() }

  // No debt
  if (/қарздорлик\s+аниқланмади|qarzdorlik\s+aniqlanmadi/i.test(text)) {
    const msg = text.match(/[^.]*қарздорлик\s+аниқланмади[^.]*/i)?.[0]?.trim()
    return { ...base, hasDebt: false, status: 'clean', message: msg || 'Qarzdorlik aniqlanmadi' }
  }

  if (!text.includes('Ижро иши рақами')) {
    return {
      ...base,
      hasDebt: false,
      status: 'error',
      message: 'MIB natijasi topilmadi. Sahifa mazmunini toʻliq nusxalanganiga ishonch hosil qiling.',
    }
  }

  const totalDebt = fieldAfter(text, 'Умумий қарздорлик')
  const currentDebt = fieldAfter(text, 'Жорий қарздорлик')

  const debts: MibDebt[] = []
  const blocks = text.split('Ижро иши рақами')
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i]
    const num = block.match(/\d{10,16}/)?.[0]
    if (!num) continue
    debts.push({
      enforcementCaseNumber: num,
      status: fieldAfter(block, 'Ҳужжат ҳолати') ?? '—',
      subject: fieldAfter(block, 'И/Ҳ мазмуни') ?? '—',
      department: fieldAfter(block, 'Ҳужжат иш юритувида') ?? fieldAfter(block, 'Бўлим') ?? '—',
      collector: fieldAfter(block, 'Ундирувчи') ?? '—',
      amount: parseAmount(fieldAfter(block, 'Қарздорлик миқдори') ?? '0'),
    })
  }

  const hasDebt = debts.length > 0
  return {
    ...base,
    hasDebt,
    status: hasDebt ? 'debt' : 'error',
    message: hasDebt
      ? (text.match(/[^.]*қарздорлик\s+мавжуд[^.]*/i)?.[0]?.trim() || `${debts.length} ta ijro ishi topildi`)
      : 'MIB natijasi oʻqilmadi',
    totalDebt: totalDebt ? parseAmount(totalDebt) : undefined,
    currentDebt: currentDebt ? parseAmount(currentDebt) : undefined,
    debts: hasDebt ? debts : undefined,
  }
}
