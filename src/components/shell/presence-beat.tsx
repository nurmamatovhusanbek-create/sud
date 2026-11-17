'use client'

/**
 * «This window is open» — a ping every 30 s and a goodbye when the page goes away, so a server started by Sud.bat can shut
 * itself down once the last window is closed (server/presence, scripts/supervisor.mjs). If the server says it was not
 * started that way (`autoExit: false`) the page stops pinging at once. Mounted once in the root layout. Renders nothing.
 */

import { useEffect } from 'react'
import { authHeaders } from '@/lib/api-client'

const BEAT_MS = 30_000

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
  }
}

export function PresenceBeat() {
  useEffect(() => {
    const id = newId()
    let timer: ReturnType<typeof setInterval> | null = null
    let enabled = true

    const post = (bye: boolean) =>
      fetch('/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(bye ? { id, bye: true } : { id }),
        keepalive: true, // survives the page being closed
        cache: 'no-store',
      })

    const stop = () => {
      enabled = false
      if (timer) clearInterval(timer)
      timer = null
    }
    const beat = () => {
      if (!enabled) return
      void post(false)
        .then((r) => r.json())
        .then((j: { ok?: boolean; data?: { autoExit?: boolean } }) => {
          if (j?.ok && j.data?.autoExit === false) stop()
        })
        .catch(() => undefined) // the server is gone or restarting: nothing to do
    }
    const start = () => {
      if (timer || !enabled) return
      beat()
      timer = setInterval(beat, BEAT_MS)
    }

    const onHide = (e: PageTransitionEvent) => {
      if (e.persisted) return // kept in the back/forward cache, not closed
      if (enabled) void post(true).catch(() => undefined)
    }
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) start() // restored from the cache: it is open again
    }
    window.addEventListener('pagehide', onHide)
    window.addEventListener('pageshow', onShow)
    start()
    return () => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('pageshow', onShow)
      if (timer) clearInterval(timer)
    }
  }, [])
  return null
}
