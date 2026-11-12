'use client'

/**
 * Light / dark, without next-themes. That library renders a <script> inside a client component, which React 19.2
 * reports as «Encountered a script tag while rendering React component» on every load. The app only ever needed two
 * themes stored under one key, so this is that: the choice lives in localStorage['theme'], is put on <html data-theme>
 * by the inline boot script (core/ui-version › UI_BOOT_SCRIPT) before the first paint, and is changed here.
 */

import { useCallback, useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'
export const THEME_KEY = 'theme'
export const DEFAULT_THEME: Theme = 'light'
const EVENT = 'sud:theme'

/** Anything that is not exactly «dark» is light (also covers the old next-themes value «system» and junk). */
export function parseTheme(raw: unknown): Theme {
  return raw === 'dark' ? 'dark' : 'light'
}

export function getTheme(): Theme {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY))
  } catch {
    return DEFAULT_THEME
  }
}

function apply(t: Theme): void {
  const el = document.documentElement
  // no transition storm while every colour flips at once
  const off = document.createElement('style')
  off.textContent = '*,*::before,*::after{transition:none!important}'
  document.head.appendChild(off)
  el.setAttribute('data-theme', t)
  el.style.colorScheme = t
  // force the flip to paint without transitions, then restore them
  void window.getComputedStyle(document.body).opacity
  setTimeout(() => off.remove(), 1)
}

export function setTheme(t: string): void {
  const next = parseTheme(t)
  try {
    localStorage.setItem(THEME_KEY, next)
  } catch {
    /* private mode: the theme still changes for this tab */
  }
  apply(next)
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

/** Same shape the app used from next-themes: `{ theme, setTheme }`. */
export function useTheme(): { theme: Theme; setTheme: (t: string) => void } {
  const theme = useSyncExternalStore(subscribe, getTheme, () => DEFAULT_THEME)
  return { theme, setTheme: useCallback((t: string) => setTheme(t), []) }
}
