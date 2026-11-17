'use client'

/**
 * How the operator writes documents in Uzbek: old Latin, new Latin or Cyrillic (core/uz-alphabet), remembered in the browser. One global
 * choice shared by the document editor, the spreadsheet panel and the Uzbek talabnoma; it is sent with each request
 * (the server never remembers it). Default: the old alphabet, which is what the templates are written in. A document
 * without a Cyrillic version (DocDef.cyrillic) ignores a saved «cyr» and stays Latin.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { DEFAULT_LATIN_SCRIPT, parseScript, type UzScript } from '@/core/uz-alphabet'

export const SCRIPT_KEY = 'sud-doc-script'
const EVENT = 'sud:doc-script'

export function getDocScript(): UzScript {
  try {
    return parseScript(localStorage.getItem(SCRIPT_KEY))
  } catch {
    return DEFAULT_LATIN_SCRIPT
  }
}

export function setDocScript(s: UzScript): void {
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
export function useDocScript(): [UzScript, (s: UzScript) => void] {
  const script = useSyncExternalStore(subscribe, getDocScript, () => DEFAULT_LATIN_SCRIPT)
  return [script, useCallback((s: UzScript) => setDocScript(s), [])]
}
