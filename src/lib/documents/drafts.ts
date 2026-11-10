/**
 * Half-filled forms that survive a refresh, a closed tab or a switch to another document.
 *
 * One draft per editor (`doc:<id>` for a separate category's document, `tab:<id>` for a combined category). Only the
 * values that DIFFER from the form's defaults are stored, so a later change of a default still reaches an old draft
 * and a draft of an untouched form is not stored at all. Pure: the storage is injected (the browser's localStorage, or
 * a fake in tests), every read is validated, every write is best effort (a full or blocked storage must never break
 * the editor).
 */

export interface StorageLike {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
  readonly length: number
  key(i: number): string | null
}

export interface Draft {
  key: string
  /** only the changed values */
  values: Record<string, string>
  savedAt: number
}

const PREFIX = 'sud.doc-draft.v1:'
export const MAX_DRAFTS = 30
const MAX_VALUE = 20_000

export const draftKeyFor = (e: { docId?: string; tabId: string }): string => (e.docId ? `doc:${e.docId}` : `tab:${e.tabId}`)

const isStrMap = (v: unknown): v is Record<string, string> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string' && x.length <= MAX_VALUE)

function parse(key: string, raw: string | null): Draft | null {
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as { values?: unknown; savedAt?: unknown }
    if (!isStrMap(j.values) || typeof j.savedAt !== 'number' || !Object.keys(j.values).length) return null
    return { key, values: j.values, savedAt: j.savedAt }
  } catch {
    return null
  }
}

export function loadDraft(s: StorageLike, key: string): Draft | null {
  try {
    return parse(key, s.getItem(PREFIX + key))
  } catch {
    return null
  }
}

/** the values that differ from the defaults (a cleared default counts: «' '» vs «»), for keys the form knows */
export function changedValues(values: Record<string, string>, defaults: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of Object.keys(defaults)) {
    const v = values[k] ?? ''
    if (v !== (defaults[k] ?? '')) out[k] = v
  }
  return out
}

/** store the draft (or remove it when nothing differs from the defaults); trims the oldest beyond MAX_DRAFTS */
export function saveDraft(s: StorageLike, key: string, values: Record<string, string>, defaults: Record<string, string>, now = Date.now()): void {
  try {
    const diff = changedValues(values, defaults)
    if (!Object.keys(diff).length) {
      s.removeItem(PREFIX + key)
      return
    }
    s.setItem(PREFIX + key, JSON.stringify({ values: diff, savedAt: now }))
    const all = listDrafts(s)
    for (const d of all.slice(MAX_DRAFTS)) s.removeItem(PREFIX + d.key)
  } catch {
    /* storage full or blocked: the form keeps working, it just is not saved */
  }
}

export function clearDraft(s: StorageLike, key: string): void {
  try {
    s.removeItem(PREFIX + key)
  } catch {
    /* nothing to clear */
  }
}

/** every stored draft, newest first */
export function listDrafts(s: StorageLike): Draft[] {
  const out: Draft[] = []
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (!k || !k.startsWith(PREFIX)) continue
      const d = parse(k.slice(PREFIX.length), s.getItem(k))
      if (d) out.push(d)
    }
  } catch {
    /* unreadable storage: no drafts */
  }
  return out.sort((a, b) => b.savedAt - a.savedAt)
}
