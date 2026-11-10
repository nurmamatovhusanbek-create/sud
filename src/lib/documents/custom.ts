import { DOCS, FIELDS, type DocDef, type FieldDef } from './registry'

/**
 * Your own templates: a .docx with `{{key}}` markers becomes a document in the picker, without code.
 *
 * Pure and isomorphic. Word splits text into runs at will, so `{{company}}` is often stored as `{{comp` + `any}}` in two
 * runs; `normalizePlaceholders` puts every marker back into ONE run (and lowercases it, trims spaces inside the braces),
 * which is what the fill (`fill.shared.ts`) needs. `scanTemplate` reports the keys found and the markers it could not
 * read. A key that the catalog already knows (`company`, `director`, `court`, `phone`… see `FIELDS`) keeps its label,
 * default, example and checks; any other key becomes a plain text field labelled after the key.
 */

/** a key the fill understands (fill.shared.ts PLACEHOLDER): lowercase letters, digits, underscore */
export const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/
export const MAX_CUSTOM_FIELDS = 80

const RAW = /\{\{\s*([^{}]*?)\s*\}\}/g
const TEXT_NODE = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g
const PARAGRAPH = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g

const canon = (inner: string): string => inner.trim().toLowerCase().replace(/[\s-]+/g, '_')

/** Merge the text of one paragraph's runs, find markers (even across runs) and rewrite them as `{{key}}` in one run. */
function normalizeParagraph(p: string, found: { keys: string[]; invalid: string[] }): string {
  const nodes: { start: number; end: number; open: string; text: string; close: string; a: number }[] = []
  let full = ''
  for (const m of p.matchAll(TEXT_NODE)) {
    const start = m.index!
    nodes.push({ start, end: start + m[0].length, open: m[1], text: m[2], close: m[3], a: full.length })
    full += m[2]
  }
  if (!full.includes('{{')) return p

  const keep = new Array<boolean>(full.length).fill(true)
  const insert = new Map<number, string>()
  for (const m of full.matchAll(RAW)) {
    const key = canon(m[1])
    const at = m.index!
    for (let i = at; i < at + m[0].length; i++) keep[i] = false
    if (KEY_RE.test(key)) {
      insert.set(at, `{{${key}}}`)
      if (!found.keys.includes(key)) found.keys.push(key)
    } else {
      insert.set(at, m[0]) // leave what could not be read exactly as it was, so the person can see and fix it
      found.invalid.push(m[0])
      for (let i = at; i < at + m[0].length; i++) keep[i] = true
    }
  }

  let out = p
  for (let n = nodes.length - 1; n >= 0; n--) {
    const node = nodes[n]
    let text = ''
    for (let i = 0; i < node.text.length; i++) {
      const pos = node.a + i
      const ins = insert.get(pos)
      if (ins !== undefined && keep[pos] === false) text += ins
      if (keep[pos]) text += node.text[i]
    }
    if (text === node.text) continue
    const open = /xml:space=/.test(node.open) ? node.open : node.open.replace(/^<w:t/, '<w:t xml:space="preserve"')
    out = out.slice(0, node.start) + open + text + node.close + out.slice(node.end)
  }
  return out
}

export interface TemplateScan {
  /** document.xml with every marker in one run, as `{{key}}` */
  xml: string
  /** the keys found, in order of first appearance */
  keys: string[]
  /** markers that are not a valid key (`{{full-name!}}`), left as they were */
  invalid: string[]
}

export function scanTemplate(xml: string): TemplateScan {
  const found = { keys: [] as string[], invalid: [] as string[] }
  const out = xml.replace(PARAGRAPH, (p) => normalizeParagraph(p, found))
  return { xml: out, keys: found.keys, invalid: [...new Set(found.invalid)] }
}

// ---- metadata and the in-memory registry -------------------------------------------------------------------------------

export interface CustomMeta {
  id: string
  title: string
  subtitle: string
  /** the markers of the template, in order, with the label each is shown under */
  fields: { key: string; label: string }[]
  createdAt: number
}

export const CUSTOM_PREFIX = 'custom_'
export const isCustomId = (id: string): boolean => id.startsWith(CUSTOM_PREFIX)

/** «sender_name» → «Sender name» */
export const humanize = (key: string): string => {
  const s = key.replace(/_/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : key
}

export const slugify = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ʻʼ'’‘`]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'shablon'

export function metaFor(title: string, keys: string[], id: string, now = Date.now()): CustomMeta {
  return {
    id,
    title: title.trim().slice(0, 80) || 'Shablon',
    subtitle: `${keys.length} ta maydon`,
    fields: keys.map((key) => ({ key, label: FIELDS[key]?.label ?? humanize(key) })),
    createdAt: now,
  }
}

/** put the custom documents into the registry (replacing earlier ones), so the editor, preview, checks and bulk fill find them */
export function registerCustomDocs(metas: CustomMeta[]): void {
  for (let i = DOCS.length - 1; i >= 0; i--) if (isCustomId(DOCS[i].id)) DOCS.splice(i, 1)
  for (const m of metas) {
    for (const f of m.fields) {
      if (!FIELDS[f.key]) FIELDS[f.key] = { key: f.key, label: f.label } satisfies FieldDef
    }
    DOCS.push({
      id: m.id, tab: 'custom', lang: 'uz', slug: slugify(m.title), title: m.title, subtitle: m.subtitle,
      file: `${m.id}.docx`, fields: m.fields.map((f) => f.key), keywords: 'oz shablon custom',
    } satisfies DocDef)
  }
}
