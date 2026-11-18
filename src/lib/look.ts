'use client'

/**
 * Which look the app wears: «vivid» (default) or «calm». Stored in localStorage['look'], put on <html data-look> before the first
 * paint by LOOK_BOOT_SCRIPT (lib/theme-boot) and changed here. Light/dark is separate (lib/theme).
 */

import { useCallback, useSyncExternalStore } from 'react'
import { LOOK_KEY } from './theme-boot'

export type Look = 'vivid' | 'calm'
export { LOOK_KEY }
export const DEFAULT_LOOK: Look = 'vivid'
const EVENT = 'sud:look'

export function parseLook(raw: unknown): Look {
  return raw === 'calm' ? 'calm' : 'vivid'
}

export function getLook(): Look {
  try {
    return parseLook(localStorage.getItem(LOOK_KEY))
  } catch {
    return DEFAULT_LOOK
  }
}

export function setLook(l: string): void {
  const next = parseLook(l)
  try {
    localStorage.setItem(LOOK_KEY, next)
  } catch {
    /* private mode: the look still changes for this tab */
  }
  document.documentElement.setAttribute('data-look', next)
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

export function useLook(): { look: Look; setLook: (l: string) => void } {
  const look = useSyncExternalStore(subscribe, getLook, () => DEFAULT_LOOK)
  return { look, setLook: useCallback((l: string) => setLook(l), []) }
}
