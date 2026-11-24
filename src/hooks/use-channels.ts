'use client'

/** Settings › Telegram › Kanallar holati: what each backup channel really holds (read from Telegram, nothing changes). Needs the passphrase. */

import { useState } from 'react'
import { toast } from 'sonner'
import { privilegedHeaders } from '@/lib/api-client'

export interface ChannelReport {
  chat: string
  role: 'asosiy' | 'zaxira'
  ok: boolean
  error?: string
  messageId?: number
  created?: string
  since?: string
  buckets?: number
  parts?: number
  partsMissing?: number
  companies?: number
  lacking?: number
}

export function useChannels() {
  const [channels, setChannels] = useState<ChannelReport[] | null>(null)
  const [busy, setBusy] = useState(false)

  const check = async (passphrase: string): Promise<void> => {
    setBusy(true)
    try {
      const res = await fetch('/api/settings/backup/channels', { method: 'POST', headers: privilegedHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ passphrase }) })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: { channels?: unknown }; error?: string } | null
      if (!j?.ok || !Array.isArray(j.data?.channels)) {
        toast.error(j?.error || 'Kanallarni tekshirib boʻlmadi')
        return
      }
      setChannels(j.data.channels as ChannelReport[])
    } catch {
      toast.error('Serverga ulanib boʻlmadi')
    } finally {
      setBusy(false)
    }
  }

  return { channels, busy, check }
}
