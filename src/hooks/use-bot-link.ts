'use client'

/** Settings › Telegram › Bot bilan ulanish: the link with the bot (lib/bot-link): its status and switch. */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { authHeaders, privilegedHeaders } from '@/lib/api-client'

export interface BotLinkStatus {
  enabled: boolean
  url: string
  hasBot: boolean
  lastPullAt: number
  lastPingAt: number
  lastError: string | null
  queued: number
  running: string | null
}

const isStatus = (v: unknown): v is BotLinkStatus => !!v && typeof v === 'object' && typeof (v as BotLinkStatus).enabled === 'boolean' && typeof (v as BotLinkStatus).url === 'string'

export function useBotLink() {
  const [status, setStatus] = useState<BotLinkStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/bot-link', { headers: authHeaders(), cache: 'no-store' })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null
      if (j?.ok && isStatus(j.data)) setStatus(j.data)
    } catch {
      /* the block stays as it was */
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 15_000)
    return () => clearInterval(t)
  }, [load])

  const set = async (enabled: boolean, url?: string): Promise<boolean> => {
    setBusy(true)
    try {
      const res = await fetch('/api/settings/bot-link', { method: 'POST', headers: privilegedHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ enabled, url }) })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: unknown; error?: string } | null
      if (!j?.ok || !isStatus(j.data)) {
        toast.error(j?.error || 'Saqlab boʻlmadi')
        return false
      }
      setStatus(j.data)
      return true
    } catch {
      toast.error('Serverga ulanib boʻlmadi')
      return false
    } finally {
      setBusy(false)
    }
  }

  return { status, busy, enable: (url: string) => set(true, url), disable: () => set(false) }
}
