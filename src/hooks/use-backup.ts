'use client'

/** Settings › Telegram › encrypted copy: start a backup or a restore, watch its progress. Polls only while a job runs; nothing starts by itself. */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { authHeaders, privilegedHeaders } from '@/lib/api-client'
import type { BackupState } from '@/lib/backup'

export interface BackupLast {
  created: string
  chunks: number
  dbBytes: number
  uploadedBytes: number
  pinned: boolean
}
interface Snap {
  state: BackupState
  last: BackupLast | null
}

const RUNNING = ['snapshot', 'compress', 'upload', 'manifest', 'download', 'unpack']

const unwrap = async (res: Response): Promise<{ ok: true; data: Snap } | { ok: false; error: string }> => {
  const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: Snap; error?: string } | null
  return j && j.ok && j.data?.state ? { ok: true, data: j.data } : { ok: false, error: j?.error || `HTTP ${res.status}` }
}

export function useBackup() {
  const [snap, setSnap] = useState<Snap | null>(null)
  const running = !!snap && RUNNING.includes(snap.state.phase)

  const load = useCallback(async () => {
    try {
      const r = await unwrap(await fetch('/api/settings/backup', { headers: authHeaders(), cache: 'no-store' }))
      if (r.ok) setSnap(r.data)
    } catch {
      /* try again on the next tick */
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => void load(), 1500)
    return () => clearInterval(t)
  }, [running, load])

  const start = async (kind: 'backup' | 'restore', passphrase: string): Promise<boolean> => {
    try {
      const url = kind === 'backup' ? '/api/settings/backup' : '/api/settings/backup/restore'
      const r = await unwrap(await fetch(url, { method: 'POST', headers: privilegedHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ passphrase }) }))
      if (r.ok) {
        setSnap(r.data)
        return true
      }
      toast.error(r.error)
    } catch {
      toast.error('Serverga ulanib boʻlmadi')
    }
    return false
  }

  return { snap, running, start, reload: load }
}
