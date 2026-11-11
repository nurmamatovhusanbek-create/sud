'use client'

/**
 * The interface switch (new «Ixcham» look ⇄ classic v18 look) and the new look's sidebar rail.
 * State = one localStorage value each + an attribute on <html> (`data-ui`, `data-side`), set before paint by
 * UI_BOOT_SCRIPT (app/layout.tsx) and kept in step here. Other tabs follow through the `storage` event.
 * Rules and the meaning of the two looks: core/ui-version.ts; the CSS: app/ui-new.css.
 */
import { useSyncExternalStore } from 'react'
import { DEFAULT_UI, SIDE_MINI_KEY, UI_STORAGE_KEY, parseUiVersion, type UiVersion } from '@/core/ui-version'

const EVENT = 'sud:ui-changed'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage blocked or full: the choice still holds for this page (the attribute is set) */
  }
}

/** Another tab changed a choice: mirror what it stored onto this page's <html>. */
function apply(): void {
  const root = document.documentElement
  const ui = read(UI_STORAGE_KEY)
  if (ui !== null) root.setAttribute('data-ui', parseUiVersion(ui))
  const mini = read(SIDE_MINI_KEY)
  if (mini === '1') root.setAttribute('data-side', 'mini')
  else if (mini !== null) root.removeAttribute('data-side')
}

function subscribe(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== UI_STORAGE_KEY && e.key !== SIDE_MINI_KEY) return
    apply()
    cb()
  }
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', onStorage)
  }
}

export function getUiVersion(): UiVersion {
  if (typeof document === 'undefined') return DEFAULT_UI
  return parseUiVersion(document.documentElement.getAttribute('data-ui'))
}

export function setUiVersion(next: UiVersion): void {
  write(UI_STORAGE_KEY, next)
  document.documentElement.setAttribute('data-ui', next)
  window.dispatchEvent(new Event(EVENT))
}

/** The look in use. Server + first client render say the default (the attribute is already right for CSS). */
export function useUiVersion(): UiVersion {
  return useSyncExternalStore(subscribe, getUiVersion, () => DEFAULT_UI)
}

function getSideMini(): boolean {
  return typeof document !== 'undefined' && document.documentElement.getAttribute('data-side') === 'mini'
}

export function setSideMini(mini: boolean): void {
  write(SIDE_MINI_KEY, mini ? '1' : '0')
  if (mini) document.documentElement.setAttribute('data-side', 'mini')
  else document.documentElement.removeAttribute('data-side')
  window.dispatchEvent(new Event(EVENT))
}

/** New look only: the sidebar is collapsed to its icon rail. */
export function useSideMini(): boolean {
  return useSyncExternalStore(subscribe, getSideMini, () => false)
}
