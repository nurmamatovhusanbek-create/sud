'use client'

/**
 * Idle auto-check: while the app sits unused (no pointer/keyboard input for a few minutes, or the tab is hidden)
 * it quietly checks the published orders of the Kuzatuv companies, at most once every 6 hours. The moment the
 * user comes back, the collecting phase stops (it must never compete with interactive requests); whatever was
 * already queued keeps running in the server's background lane. Turn it off from the Kuzatuv page.
 * Mounted once in the root layout. Renders nothing.
 */

import { useEffect } from 'react'
import { autoEnabled, checkWatchlistOrders, lastAutoRun } from '@/lib/orders-watchlist'

const IDLE_MS = 3 * 60_000
const EVERY_MS = 6 * 3_600_000
const TICK_MS = 30_000
const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const

export function OrdersAutoCheck() {
  useEffect(() => {
    let lastActive = Date.now()
    let ac: AbortController | null = null
    const onActivity = () => {
      lastActive = Date.now()
      ac?.abort() // the user is back: stop the collecting phase
    }
    for (const e of ACTIVITY) window.addEventListener(e, onActivity, { passive: true })

    const tick = () => {
      if (ac && !ac.signal.aborted) return // a run is in progress
      if (!autoEnabled()) return
      const idle = document.visibilityState === 'hidden' || Date.now() - lastActive >= IDLE_MS
      if (!idle || Date.now() - lastAutoRun() < EVERY_MS) return
      ac = new AbortController()
      const mine = ac
      void checkWatchlistOrders({ auto: true, signal: mine.signal }).finally(() => {
        if (ac === mine) ac = null
      })
    }
    const t = setInterval(tick, TICK_MS)
    const first = setTimeout(tick, 15_000) // a fresh page load that is left alone gets its turn soon
    return () => {
      clearInterval(t)
      clearTimeout(first)
      for (const e of ACTIVITY) window.removeEventListener(e, onActivity)
      ac?.abort()
    }
  }, [])
  return null
}
