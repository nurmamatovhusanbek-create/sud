'use client'

/** Settings › Telegram › «Nima yuklanmagan?»: what this computer holds that each channel does not hold yet (local comparison: no passphrase, nothing is asked of Telegram). */

import { useState } from 'react'
import { toast } from 'sonner'
import { authHeaders } from '@/lib/api-client'

export interface PendingItem {
  name: string
  label: string
  rows: number
  was?: number
}
export interface PendingChannel {
  chat: string
  role: 'asosiy' | 'zaxira'
  known: boolean
  lastAt: string
  fresh: PendingItem[]
  changed: PendingItem[]
  freshCount: number
  changedCount: number
  unchanged: number
  freshPdfs: number
}
export interface PendingReport {
  configured: boolean
  total?: number
  channels?: PendingChannel[]
}

const isReport = (v: unknown): v is PendingReport => !!v && typeof v === 'object' && typeof (v as PendingReport).configured === 'boolean'

export function usePendingBackup() {
  const [report, setReport] = useState<PendingReport | null>(null)
  const [busy, setBusy] = useState(false)
  const check = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await fetch('/api/settings/backup/pending', { headers: authHeaders(), cache: 'no-store' })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: unknown; error?: string } | null
      if (!j?.ok || !isReport(j.data)) {
        toast.error(j?.error || 'Solishtirib boʻlmadi')
        return
      }
      setReport(j.data)
    } catch {
      toast.error('Serverga ulanib boʻlmadi')
    } finally {
      setBusy(false)
    }
  }
  return { report, busy, check }
}
