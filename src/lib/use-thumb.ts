'use client'

/**
 * A SLIDING indicator for a row or column of buttons (sidebar nav, tabs, the filter segment): measures the active button and returns where
 * the indicator must sit, so one element glides from the old button to the new one instead of the mark popping in and out. The CSS moves it
 * with `transform` only (translate + scale), never left/width, see app/motion-premium.css. `ready` turns true after the first measurement,
 * so the indicator is PLACED on load and only animates on later changes.
 */
import { useEffect, useState, type RefObject } from 'react'

export interface Thumb {
  x: number
  y: number
  w: number
  h: number
}

export function useThumb(ref: RefObject<HTMLElement | null>, deps: readonly unknown[], active = 'button.on, .set-tab.on'): { thumb: Thumb | null; ready: boolean } {
  const [thumb, setThumb] = useState<Thumb | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const measure = () => {
      const el = root.querySelector<HTMLElement>(active)
      if (!el) return setThumb(null)
      const next = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }
      setThumb((p) => (p && p.x === next.x && p.y === next.y && p.w === next.w && p.h === next.h ? p : next))
    }
    measure()
    const raf = requestAnimationFrame(() => setReady(true)) // placed first, animated afterwards
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    void document.fonts?.ready.then(measure) // the first measurement may precede the web font
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, deps)
  return { thumb, ready }
}

/** CSS custom properties for the indicator (numbers, unitless: the stylesheet adds px / divides) */
export const thumbVars = (t: Thumb | null): React.CSSProperties =>
  t ? ({ ['--tx' as string]: t.x, ['--ty' as string]: t.y, ['--tw' as string]: t.w, ['--th' as string]: t.h } as React.CSSProperties) : {}
