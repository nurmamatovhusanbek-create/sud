import { describe, expect, test } from 'bun:test'
import { buildReportModel, type ReportInput } from '../model'
import { renderReportBody, renderReportFooter, reportTheme } from '../render'
import { buildPrintDoc } from '@/lib/print'
import { FULL } from './fixtures'

/**
 * Court and company data is typed by third parties (a litigant chooses their own name; a registry holds whatever its
 * clerk wrote), then written with `document.write` into a print window that shares the app's origin. One unescaped field
 * would run attacker script with the power to call the app's privileged routes. This appends a payload to EVERY string in
 * a full report input and checks that none of it reaches the HTML as markup.
 */
const PAYLOADS = [
  '"><img src=x onerror=alert(1)>',
  "'><script>alert(1)</script>",
  '" onmouseover="alert(1)" x="',
  "</style><svg onload=alert(1)>",
  '</title><script>alert(1)</script>',
]

function poison<T>(v: T, payload: string): T {
  if (typeof v === 'string') return (v + payload) as unknown as T
  if (Array.isArray(v)) return v.map((x) => poison(x, payload)) as unknown as T
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, poison(x, payload)])) as T
  }
  return v
}

const DANGEROUS_TAGS = new Set(['script', 'img', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'style', 'video', 'audio', 'a', 'button', 'textarea', 'select', 'foreignobject'])

/**
 * What an attacker string could only produce by getting OUT of text or an attribute value: a tag we never write, or an
 * event-handler attribute. Quoted attribute values are stripped first, so escaped payload text sitting inside an
 * `aria-label="…"` is not mistaken for markup. Returns a short list of findings (empty = clean).
 */
function injected(html: string, allowedTags: Set<string>): string[] {
  const found: string[] = []
  for (const m of html.matchAll(/<\/?([a-zA-Z][\w:-]*)([^>]*)>/g)) {
    const tag = m[1].toLowerCase()
    const attrs = m[2].replace(/"[^"]*"|'[^']*'/g, '""')
    if (DANGEROUS_TAGS.has(tag) && !allowedTags.has(tag)) found.push(`<${tag}>`)
    if (/[\s"']on[a-z]+\s*=/i.test(' ' + attrs)) found.push(`on* attribute in <${tag}>`)
  }
  return found.slice(0, 5)
}

// tags the report legitimately writes (found by rendering the clean fixture): none of the dangerous ones
const BASELINE = (() => {
  const m = buildReportModel(FULL)
  const b = renderReportBody(m, reportTheme(false))
  const used = new Set<string>()
  for (const t of [b.rail, b.main].join('').matchAll(/<([a-zA-Z][\w:-]*)/g)) used.add(t[1].toLowerCase())
  return new Set([...used].filter((t) => DANGEROUS_TAGS.has(t)))
})()

describe('report HTML: scraped text never becomes markup', () => {
  test('the detector itself works (a real injection is caught, escaped text is not)', () => {
    expect(injected('<p>ok</p><img src=x onerror=alert(1)>', new Set())).toContain('<img>')
    expect(injected('<p title="x" onclick="a()">', new Set())).toContain('on* attribute in <p>')
    expect(injected('<svg aria-label="&lt;svg onload=alert(1)&gt;"><path d="M0"/></svg>', new Set())).toEqual([])
  })

  for (const payload of PAYLOADS) {
    test(`payload ${payload.slice(0, 24)}…`, () => {
      const input: ReportInput = { ...poison(FULL, payload), generatedAt: FULL.generatedAt }
      const model = buildReportModel(input)
      const t = reportTheme(false)
      const body = renderReportBody(model, t)
      const foot = renderReportFooter(model)
      const html = [body.rail, body.main, foot.rail, foot.main].join('\n')
      expect(html.length).toBeGreaterThan(500) // the payload did not blank the report out
      expect(injected(html, BASELINE)).toEqual([])
      expect(/&(lt|gt|quot|#39|amp);/.test(html)).toBe(true) // the payload text IS still shown, escaped
    })
  }
  test('the print wrapper escapes the title', () => {
    const doc = buildPrintDoc('</title><script>alert(1)</script>', '<p>x</p>', false)
    expect(doc.includes('<script>alert(1)')).toBe(false)
    expect(doc.includes('&lt;/title&gt;')).toBe(true)
  })
})
