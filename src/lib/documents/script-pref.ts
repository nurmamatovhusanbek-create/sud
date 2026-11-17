'use client'

/**
 * Which Uzbek Latin alphabet the operator writes documents in (core/uz-alphabet), remembered in the browser. One global
 * choice shared by the document editor, the spreadsheet panel and the Uzbek talabnoma; it is sent with each request
 * (the server never remembers it). Default: the old alphabet, which is what the templates are written in.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { DEFAULT_LATIN_SCRIPT, parseLatinScript, type LatinScript } from '@/core/uz-alphabet'

export const SCRIPT_KEY = 'sud-doc-script'
const EVENT = 'sud:doc-script'

export function getLatinScript(): LatinScript {
  try {
    return parseLatinScript(localStorage.getItem(SCRIPT_KEY))
  } catch {
    return DEFAULT_LATIN_SCRIPT
  }
}

export function setLatinScript(s: LatinScript): void {
  try {
    localStorage.setItem(SCRIPT_KEY, s)
  } catch {
    /* private mode: the choice still applies to this tab */
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

/** `[script, setScript]`; the server render and the first client render say «old», then the saved choice. */
export function useLatinScript(): [LatinScript, (s: LatinScript) => void] {
  const script = useSyncExternalStore(subscribe, getLatinScript, () => DEFAULT_LATIN_SCRIPT)
  return [script, useCallback((s: LatinScript) => setLatinScript(s), [])]
}
