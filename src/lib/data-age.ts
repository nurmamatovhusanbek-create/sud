'use client'

/**
 * How old the data on screen is. Each section that reads a daily snapshot reports the time the sites answered
 * (`meta.fetchedAt`); the company header shows the OLDEST of them (honest: that is how stale the dossier may be).
 * Upcoming hearings are live and report nothing.
 */

import { useSyncExternalStore } from 'react'

export interface DataAge {
  /** the oldest fetch time among the reported parts (ms), null when none reported */
  oldest: number | null
  /** some part is past its day and the sites failed */
  stale: boolean
  /** part → fetch time, for the tooltip */
  parts: Readonly<Record<string, number>>
}

const EMPTY: DataAge = { oldest: null, stale: false, parts: {} }
const raw = new Map<string, Map<string, { t: number; stale: boolean }>>()
const snap = new Map<string, DataAge>()
const listeners = new Set<() => void>()

function rebuild(stir: string): void {
  const parts = raw.get(stir)
  if (!parts || parts.size === 0) {
    snap.delete(stir)
  } else {
    let oldest = Infinity
    let stale = false
    const out: Record<string, number> = {}
    for (const [k, v] of parts) {
      out[k] = v.t
      if (v.t < oldest) oldest = v.t
      if (v.stale) stale = true
    }
    snap.set(stir, { oldest, stale, parts: out }) // a NEW object only when something changed (useSyncExternalStore)
  }
  listeners.forEach((fn) => fn())
}

/** A section read `part` of `stir`; pass `undefined` when it has nothing (loading, error) to forget the part. */
export function reportAge(stir: string, part: string, fetchedAt: number | undefined, stale = false): void {
  if (!stir) return
  let parts = raw.get(stir)
  const cur = parts?.get(part)
  if (fetchedAt === undefined) {
    if (!cur) return
    parts!.delete(part)
  } else {
    if (cur && cur.t === fetchedAt && cur.stale === stale) return
    if (!parts) raw.set(stir, (parts = new Map()))
    parts.set(part, { t: fetchedAt, stale })
  }
  rebuild(stir)
}

/** Everything about `stir` is being re-read: forget what was reported. */
export function clearAge(stir: string): void {
  if (raw.delete(stir)) rebuild(stir)
}

export function useDataAge(stir: string | undefined): DataAge {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => (stir ? snap.get(stir) ?? EMPTY : EMPTY),
    () => EMPTY,
  )
}
