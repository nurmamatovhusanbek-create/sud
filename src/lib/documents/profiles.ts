import type { StorageLike } from './drafts'

/**
 * Saved «people and companies» for the document forms: fill a group of fields once (a company and its director, an
 * applicant with passport, a counterparty), name it, and pick it from a list next time instead of retyping.
 *
 * A profile belongs to a GROUP OF FIELDS (the section's keys), so a profile saved in one document is offered by every
 * section with exactly the same fields in any other document. Pure: the storage is injected; reads are validated and
 * writes are best effort.
 */

export interface Profile {
  id: string
  name: string
  values: Record<string, string>
  savedAt: number
}

const STORE = 'sud.doc-profiles.v1'
export const MAX_PROFILES = 50
const MAX_VALUE = 5_000

/** the group a profile belongs to: its field keys (order does not matter) */
export const profileNs = (keys: string[]): string => [...keys].sort().join('|')

type All = Record<string, Profile[]>

const isProfile = (p: unknown): p is Profile => {
  const o = p as Partial<Profile> | null
  return !!o && typeof o.id === 'string' && typeof o.name === 'string' && typeof o.savedAt === 'number' && !!o.values && typeof o.values === 'object' && !Array.isArray(o.values) && Object.values(o.values).every((v) => typeof v === 'string' && v.length <= MAX_VALUE)
}

function readAll(s: StorageLike): All {
  try {
    const j = JSON.parse(s.getItem(STORE) ?? '{}') as Record<string, unknown>
    const out: All = {}
    for (const [ns, list] of Object.entries(j)) if (Array.isArray(list)) out[ns] = list.filter(isProfile)
    return out
  } catch {
    return {}
  }
}

function writeAll(s: StorageLike, all: All): void {
  try {
    s.setItem(STORE, JSON.stringify(all))
  } catch {
    /* storage full or blocked: profiles simply are not saved */
  }
}

/** the profiles of this group, most recently saved first */
export function listProfiles(s: StorageLike, ns: string): Profile[] {
  return [...(readAll(s)[ns] ?? [])].sort((a, b) => b.savedAt - a.savedAt)
}

/** only the filled values of these keys */
export function profileValues(keys: string[], values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of keys) if ((values[k] ?? '').trim()) out[k] = values[k].trim()
  return out
}

/** a name to offer: the first filled field that usually names the thing */
export function suggestName(keys: string[], values: Record<string, string>): string {
  const names = ['company', 'full_name', 'applicant_person', 'emp_name', 'director', 'rep_name', 'beneficiary', 'plaintiff']
  for (const k of [...names.filter((n) => keys.includes(n)), ...keys]) {
    const v = (values[k] ?? '').trim()
    if (v) return v.length > 60 ? `${v.slice(0, 57)}…` : v
  }
  return ''
}

/** save under `name` (the same name, case-insensitively, is replaced); returns the stored profile or null when there is nothing to save */
export function saveProfile(s: StorageLike, ns: string, keys: string[], name: string, values: Record<string, string>, now = Date.now()): Profile | null {
  const vals = profileValues(keys, values)
  const nm = name.trim().slice(0, 80)
  if (!nm || !Object.keys(vals).length) return null
  const all = readAll(s)
  const rest = (all[ns] ?? []).filter((p) => p.name.toLowerCase() !== nm.toLowerCase())
  const p: Profile = { id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: nm, values: vals, savedAt: now }
  all[ns] = [p, ...rest].slice(0, MAX_PROFILES)
  writeAll(s, all)
  return p
}

export function deleteProfile(s: StorageLike, ns: string, id: string): void {
  const all = readAll(s)
  if (!all[ns]) return
  all[ns] = all[ns].filter((p) => p.id !== id)
  if (!all[ns].length) delete all[ns]
  writeAll(s, all)
}

/** the form's values with the profile laid over the group's keys (a key the profile lacks is left as it is) */
export function applyProfile(values: Record<string, string>, keys: string[], p: Profile): Record<string, string> {
  const out = { ...values }
  for (const k of keys) if (k in p.values) out[k] = p.values[k]
  return out
}
