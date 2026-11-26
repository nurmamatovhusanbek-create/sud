'use client'

/** Settings › Telegram › Kuzatuv: the automatic read of court lists with Telegram messages. Setting, last run, and the two buttons (read now, test message). */

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/lib/notify'
import { authHeaders, privilegedHeaders } from '@/lib/api-client'
import type { WatchConfig } from '@/core/watch'

export interface WatchLast {
  at: number
  ms: number
  companies: number
  rows: number
  events: number
  sent: number
  baselines: number
  errors: string[]
}
export interface WatchSnap {
  config: WatchConfig
  last: WatchLast | null
  nextAt: number | null
  running: boolean
  watching: string[]
}

const isSnap = (v: unknown): v is WatchSnap => !!v && typeof v === 'object' && !!(v as WatchSnap).config && Array.isArray((v as WatchSnap).watching)

export function useWatch() {
  const [snap, setSnap] = useState<WatchSnap | null>(null)
  const [busy, setBusy] = useState<'save' | 'run' | 'test' | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/watch', { headers: authHeaders(), cache: 'no-store' })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null
      if (j?.ok && isSnap(j.data)) {
        setSnap(j.data)
        return j.data
      }
    } catch {
      /* the card stays as it was */
    }
    return null
  }, [])

  useEffect(() => {
    void load()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [load])

  // while a run is going the card looks again every few seconds; it stops by itself when the run ends
  const follow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    const again = async () => {
      const s = await load()
      if (s?.running) timer.current = setTimeout(again, 4000)
    }
    timer.current = setTimeout(again, 4000)
  }, [load])

  const post = async (query: string, body?: unknown) => {
    const res = await fetch(`/api/settings/watch${query}`, { method: 'POST', headers: privilegedHeaders({ 'Content-Type': 'application/json' }), body: body === undefined ? undefined : JSON.stringify(body) })
    return (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
  }

  const save = async (patch: Partial<WatchConfig>): Promise<boolean> => {
    setBusy('save')
    try {
      const j = await post('', patch)
      if (!j?.ok) {
        toast.error(j?.error || 'Saqlab boʻlmadi')
        return false
      }
      await load()
      return true
    } catch {
      toast.error('Serverga ulanib boʻlmadi')
      return false
    } finally {
      setBusy(null)
    }
  }

  const run = async () => {
    setBusy('run')
    try {
      const j = await post('?action=run')
      if (!j?.ok) toast.error(j?.error || 'Boshlab boʻlmadi')
      else {
        toast.message('Roʻyxatlar oʻqilmoqda: birinchi oʻqish faqat eslab qoladi, xabar yubormaydi')
        await load()
        follow()
      }
    } catch {
      toast.error('Serverga ulanib boʻlmadi')
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    setBusy('test')
    try {
      const j = await post('?action=test')
      if (j?.ok) toast.success('Sinov xabari yuborildi')
      else toast.error(j?.error || 'Xabar yuborilmadi')
    } catch {
      toast.error('Serverga ulanib boʻlmadi')
    } finally {
      setBusy(null)
    }
  }

  return { snap, busy, save, run, test, reload: load }
}
