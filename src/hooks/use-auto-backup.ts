'use client'

/** Settings › Telegram › Avtomatik zaxira: the status of the automatic backup and its switch. The passphrase goes to this server once, to be kept in a private file. */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { authHeaders, privilegedHeaders } from '@/lib/api-client'

export interface AutoBackupStatus {
  enabled: boolean
  hasPassphrase: boolean
  lastOkAt: number
  lastAttemptAt: number
  failures: number
  lastError: string | null
  running: boolean
}

const isStatus = (v: unknown): v is AutoBackupStatus => !!v && typeof v === 'object' && typeof (v as AutoBackupStatus).enabled === 'boolean'

export function useAutoBackup() {
  const [status, setStatus] = useState<AutoBackupStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/backup/auto', { headers: authHeaders(), cache: 'no-store' })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: unknown } | null
      if (j?.ok && isStatus(j.data)) setStatus(j.data)
    } catch {
      /* the block stays as it was */
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 30_000) // a backup that ran by itself shows up
    return () => clearInterval(t)
  }, [load])

  const set = async (enabled: boolean, passphrase?: string): Promise<boolean> => {
    setBusy(true)
    try {
      const res = await fetch('/api/settings/backup/auto', { method: 'POST', headers: privilegedHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ enabled, passphrase }) })
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

  return { status, busy, enable: (passphrase: string) => set(true, passphrase), disable: () => set(false) }
}
