'use client'

/**
 * Animations: follow the system (auto), force them on, or force them off. Windows with «Show animations» switched off, a remote
 * desktop session and battery saver all make Chrome report prefers-reduced-motion: reduce, which used to turn EVERY animation
 * and count-up off with no way back inside the app. The choice lives in localStorage['motion'], is put on <html data-motion>
 * before the first paint (lib/theme-boot) and the CSS reads that attribute; script-driven motion asks `motionReduced()`.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { MOTION_KEY } from './theme-boot'

export type Motion = 'auto' | 'on' | 'off'
export { MOTION_KEY }
const EVENT = 'sud:motion'

export function parseMotion(raw: unknown): Motion {
  return raw === 'on' || raw === 'off' ? raw : 'auto'
}

export function getMotion(): Motion {
  try {
    return parseMotion(localStorage.getItem(MOTION_KEY))
  } catch {
    return 'auto'
  }
}

/** Should script-driven motion (count-ups, progress easing) stay still right now? */
export function motionReduced(): boolean {
  if (typeof window === 'undefined') return false
  const m = getMotion()
  if (m === 'on') return false
  if (m === 'off') return true
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function setMotion(m: string): void {
  const next = parseMotion(m)
  try {
    if (next === 'auto') localStorage.removeItem(MOTION_KEY)
    else localStorage.setItem(MOTION_KEY, next)
  } catch {
    /* private mode: the choice still applies to this tab */
  }
  const el = document.documentElement
  if (next === 'auto') el.removeAttribute('data-motion')
  else el.setAttribute('data-motion', next)
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

export function useMotion(): { motion: Motion; setMotion: (m: string) => void } {
  const motion = useSyncExternalStore(subscribe, getMotion, () => 'auto' as Motion)
  return { motion, setMotion: useCallback((m: string) => setMotion(m), []) }
}
