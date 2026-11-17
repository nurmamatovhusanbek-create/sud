/**
 * Which Uzbek Latin alphabet a generated document is written in (core/uz-alphabet), applied to a .docx.
 *
 * Isomorphic and pure on strings (the server fill, the PDF, the bulk ZIP and the live preview all call it, so they
 * cannot drift). Two separate steps, because a template is two kinds of text:
 *
 *   convertWordXml / applyScriptToZip   the template's own words («Oʻzbekiston Respublikasi»…), in every text part.
 *                                       {{placeholders}} are skipped, so a key such as {{short_name}} is never touched.
 *   valuesForScript                     what the operator typed (and what is derived from it), after normalising to the
 *                                       old alphabet so the Cyrillic / initials derivation keeps working on one spelling.
 *
 * Word does NOT keep a word in one run: «Oʻzbekiston» is often `Oʻ` + `zbekiston`, or `O` + `’` + `zbekiston`, and the
 * apostrophes differ. So the text of consecutive runs is handled as ONE stream per paragraph, and each edit is mapped
 * back onto the run its first character lives in; the characters it consumed are removed from the runs that held them.
 * Nothing but the text inside <w:t> changes: every tag, attribute, run property and untouched run stays byte for byte.
 */

import type JSZip from 'jszip'
import { findEdits, looksEnglish, toLatinScript, type Edit, type LatinScript } from '@/core/uz-alphabet'
import { withDerived } from './derive'

const PLACEHOLDER = /\{\{[a-z_0-9]+\}\}/g

/** The parts of a .docx that carry readable text. */
const TEXT_PART = /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes)\.xml$/

/**
 * One <w:t> element, or a boundary that text must not be read across: a paragraph edge, a line break, a tab, a picture,
 * a field character. (<w:pPr>, <w:tab/> etc. do not match <w:t / <w:p because a space, «>» or «/» must follow.)
 */
const TOKEN = new RegExp(
  [
    String.raw`<w:t(?:\s[^>]*)?\/>`,
    String.raw`<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>`,
    String.raw`<\/?w:p(?=[\s>\/])[^>]*>`,
    String.raw`<w:(?:br|cr|tab|ptab|sym|drawing|pict|object|noBreakHyphen|softHyphen|fldChar)\b[^>]*>`,
    String.raw`<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>`,
  ].join('|'),
  'g',
)

const unescapeXml = (s: string): string =>
  s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

interface Run {
  /** where the text sits inside the XML string */
  from: number
  to: number
  raw: string
  text: string
}

/** The edits for one paragraph's text: {{placeholders}} are opaque, everything else is converted. */
function editsFor(text: string, script: LatinScript): Edit[] {
  const out: Edit[] = []
  let at = 0
  const sweep = (end: number) => {
    if (end > at) for (const e of findEdits(text.slice(at, end), script)) out.push({ start: e.start + at, end: e.end + at, text: e.text })
  }
  PLACEHOLDER.lastIndex = 0
  for (let m = PLACEHOLDER.exec(text); m; m = PLACEHOLDER.exec(text)) {
    sweep(m.index)
    at = m.index + m[0].length
  }
  sweep(text.length)
  return out
}

/** Rewrite the text of one group of consecutive runs; returns [run, newText] only for runs that changed. */
function rewriteGroup(runs: Run[], script: LatinScript): Map<Run, string> {
  const changed = new Map<Run, string>()
  const joined = runs.map((r) => r.text).join('')
  const edits = editsFor(joined, script)
  if (!edits.length) return changed
  // one output cell per UTF-16 unit of the joined text; an edit writes its replacement in its first cell and empties the rest
  const cells = joined.split('')
  for (const e of edits) {
    if (e.start === e.end) cells[e.start] = e.text + cells[e.start] // zero-width: inserted before the character at `start`
    else {
      cells[e.start] = e.text
      for (let k = e.start + 1; k < e.end; k++) cells[k] = ''
    }
  }
  let off = 0
  for (const r of runs) {
    const next = cells.slice(off, off + r.text.length).join('')
    if (next !== r.text) changed.set(r, next)
    off += r.text.length
  }
  return changed
}

/** `word/*.xml` with the template's own words written in `script`. Unchanged text, tags and attributes are left as they are. */
export function convertWordXml(xml: string, script: LatinScript): string {
  const groups: Run[][] = []
  let cur: Run[] = []
  const flush = () => {
    if (cur.length) groups.push(cur)
    cur = []
  }
  TOKEN.lastIndex = 0
  for (let m = TOKEN.exec(xml); m; m = TOKEN.exec(xml)) {
    const tok = m[0]
    if (tok.startsWith('<w:t') && /^<w:t[\s>\/]/.test(tok)) {
      if (tok.endsWith('/>')) continue // <w:t/>: no text, and no boundary either
      const open = tok.indexOf('>') + 1
      const close = tok.lastIndexOf('</w:t>')
      const raw = tok.slice(open, close)
      cur.push({ from: m.index + open, to: m.index + close, raw, text: unescapeXml(raw) })
    } else flush()
  }
  flush()

  const rewrites: { from: number; to: number; text: string }[] = []
  for (const g of groups) for (const [run, text] of rewriteGroup(g, script)) rewrites.push({ from: run.from, to: run.to, text: escapeText(text) })
  if (!rewrites.length) return xml
  rewrites.sort((a, b) => a.from - b.from)
  let out = ''
  let at = 0
  for (const r of rewrites) {
    out += xml.slice(at, r.from) + r.text
    at = r.to
  }
  return out + xml.slice(at)
}

/** Convert every text part of an opened .docx in place. Returns how many parts changed. */
export async function applyScriptToZip(zip: JSZip, script: LatinScript): Promise<number> {
  let changed = 0
  for (const name of Object.keys(zip.files)) {
    if (!TEXT_PART.test(name)) continue
    const file = zip.file(name)
    if (!file) continue
    const xml = await file.async('string')
    const next = convertWordXml(xml, script)
    if (next !== xml) {
      zip.file(name, next)
      changed++
    }
  }
  return changed
}

/** Every value in `script`. Strings only; the keys are untouched. */
export function convertValues(values: Record<string, string>, script: LatinScript): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(values)) out[k] = typeof v === 'string' ? toLatinScript(v, script) : v
  return out
}

/**
 * What goes into the template: the typed values, the values derived from them (Cyrillic names, initials, dates, terms),
 * all written in `script`. Typed text is first normalised to the old alphabet, whatever it was typed in, so the
 * derivations (core/translit, initials) see ONE spelling; the result is then converted once, at the end.
 */
export function valuesForScript(values: Record<string, string>, script: LatinScript): Record<string, string> {
  return convertValues(withDerived(convertValues(values, 'old')), script)
}

/** The readable text of word/document.xml: the text of every run, a space between paragraphs. */
export function plainText(xml: string): string {
  const out: string[] = []
  TOKEN.lastIndex = 0
  for (let m = TOKEN.exec(xml); m; m = TOKEN.exec(xml)) {
    const tok = m[0]
    if (/^<w:t[\s>\/]/.test(tok) && !tok.endsWith('/>')) out.push(unescapeXml(tok.slice(tok.indexOf('>') + 1, tok.lastIndexOf('</w:t>'))))
    else if (/^<\/?w:p[\s>\/]/.test(tok)) out.push(' ')
  }
  return out.join('')
}

/**
 * The alphabet this document will really be written in, or `null` for «leave every character exactly as it is».
 * An English document (declared, or one that reads as English) gets `null` in BOTH directions: its «sh» and «ch» are not
 * Uzbek letters, and a Turkish surname such as «Özdemir» must not become «Oʻzdemir» either.
 */
export function resolveScript(documentXml: string, lang: string | undefined, requested: LatinScript): LatinScript | null {
  if (lang === 'en') return null
  return looksEnglish(plainText(documentXml)) ? null : requested
}

/** The values for a document: converted for `script`, or exactly what was typed plus the derived keys when `script` is null. */
export function valuesFor(values: Record<string, string>, script: LatinScript | null): Record<string, string> {
  return script ? valuesForScript(values, script) : withDerived(values)
}
