'use client'

/**
 * What the operator has ticked off while preparing a hearing, kept in the browser per case (like the registry: no
 * server state). `documents` is set by the app when a document is prepared from the case.
 */

const KEY = 'sud-prep-v1'
const MAX = 300

export interface PrepState {
  ticked: string[]
  documentPrepared: boolean
  at: number
}

type Store = Record<string, PrepState>

const read = (): Store => {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)
    const v = raw ? JSON.parse(raw) : {}
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Store) : {}
  } catch {
    return {}
  }
}

const key = (stir: string, caseNumber: string) => `${stir}|${caseNumber}`

export function readPrep(stir: string, caseNumber: string): PrepState {
  const s = read()[key(stir, caseNumber)]
  return { ticked: Array.isArray(s?.ticked) ? s.ticked.filter((x) => typeof x === 'string') : [], documentPrepared: s?.documentPrepared === true, at: s?.at ?? 0 }
}

export function writePrep(stir: string, caseNumber: string, patch: Partial<Pick<PrepState, 'ticked' | 'documentPrepared'>>): PrepState {
  const store = read()
  const next: PrepState = { ...readPrep(stir, caseNumber), ...patch, at: Date.now() }
  store[key(stir, caseNumber)] = next
  // keep it bounded: drop the least recently touched
  const keys = Object.keys(store)
  if (keys.length > MAX) for (const k of keys.sort((a, b) => (store[a].at ?? 0) - (store[b].at ?? 0)).slice(0, keys.length - MAX)) delete store[k]
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    /* storage full: the ticks are a convenience, not data */
  }
  return next
}
