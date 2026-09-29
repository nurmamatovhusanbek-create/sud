/**
 * Isomorphic .docx placeholder filling — imported by BOTH the server
 * (fill.server.ts, the real download) and the browser (the live preview), so
 * the preview can never drift from what the user downloads.
 *
 * Pure string work on word/document.xml; no node/browser-only imports.
 */

// A 1×1 fully transparent PNG. When no letterhead is supplied we swap the
// template's embedded banner for this — the drawing box (and thus the vertical
// space) is preserved, but no company branding is forced onto the document.
export const BLANK_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // keep quotes literal in text nodes (they are valid), but be safe in attrs
    .replace(/"/g, '&quot;')
}

const PLACEHOLDER = /\{\{([a-z_]+)\}\}/g

/**
 * Replace {{key}} placeholders. Unknown/blank keys collapse to '' so no stray
 * `{{…}}` ever survives into the delivered document.
 */
export function fillXml(xml: string, values: Record<string, string>): string {
  return xml.replace(PLACEHOLDER, (_m, key: string) => {
    const v = values[key]
    return v ? escapeXml(v) : ''
  })
}

// ---- live-preview markers ---------------------------------------------------
// The preview fills the SAME template but wraps every value in private-use
// sentinels so the rendered DOM can be re-wrapped into clickable field spans.
// U+E000–U+E002 are legal XML characters and never occur in real documents.
//    [!]key  value         ("!" = empty → show the label)

const OPEN = ''
const MID = ''
const CLOSE = ''

/** Same substitution as fillXml, but every value is wrapped in sentinels. An
 *  empty value shows the field's label instead (preview-only; the real
 *  download still collapses it to ''). */
export function markXml(
  xml: string,
  values: Record<string, string>,
  labelOf: (key: string) => string,
): string {
  return xml.replace(PLACEHOLDER, (_m, key: string) => {
    const v = values[key]
    const has = !!v
    return `${OPEN}${has ? '' : '!'}${key}${MID}${escapeXml(has ? v : labelOf(key))}${CLOSE}`
  })
}

/** Matches one marked value in rendered text: [1]=empty flag, [2]=key, [3]=text. */
export const MARK_RE = /(!?)([a-z_]+)([\s\S]*?)/g
export const MARK_OPEN = OPEN
