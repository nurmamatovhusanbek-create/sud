'use client'

/**
 * «Is the app waiting for the network right now?»: one counter that api-client's `request()` raises while a call is in flight, and a hook
 * the shell reads to draw the thin loading line under the topbar. A call shorter than `SHOW_AFTER_MS` never shows it (no flash on a fast
 * answer); once shown it stays for `MIN_SHOW_MS` so it does not blink. Nothing here starts a request: it only watches the ones the person
 * asked for (AGENTS.md: nothing starts by itself).
 */
import { useEffect, useState, useSyncExternalStore } from 'react'

let inflight = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

/** mark one request as started; call the returned function exactly when it ends (safe to call twice) */
export function beginActivity(): () => void {
  inflight++
  emit()
  let done = false
  return () => {
    if (done) return
    done = true
    inflight = Math.max(0, inflight - 1)
    emit()
  }
}

export const inflightCount = () => inflight

const subscribe = (cb: () => void) => {
  subs.add(cb)
  return () => void subs.delete(cb)
}

export const SHOW_AFTER_MS = 220
export const MIN_SHOW_MS = 420

/** true while something is loading AND it has taken longer than SHOW_AFTER_MS (then for at least MIN_SHOW_MS) */
export function useBusy(): boolean {
  const raw = useSyncExternalStore(subscribe, () => inflight > 0, () => false)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (raw) {
      const t = setTimeout(() => setShown(true), SHOW_AFTER_MS)
      return () => clearTimeout(t)
    }
    if (!shown) return
    const t = setTimeout(() => setShown(false), MIN_SHOW_MS)
    return () => clearTimeout(t)
  }, [raw, shown])
  return shown
}
