'use client'

/** Settings › Telegram › encrypted copy: start a backup or a restore, watch its progress. Polls only while a job runs; nothing starts by itself. */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { authHeaders, privilegedHeaders } from '@/lib/api-client'
import type { BackupState } from '@/lib/backup'

export interface BackupLast {
  created: string
  chunks: number
  buckets?: number
  reused?: number
  dbBytes: number
  uploadedBytes: number
  pinned: boolean
}
export interface CatalogEntry {
  tin: string
  firstAt: number
  refreshedAt: number
  bills: number
  found: number
}
export interface Catalog {
  backupAt: string
  companies: CatalogEntry[]
}
interface Snap {
  state: BackupState
  last: BackupLast | null
  catalog?: Catalog | null
}

const RUNNING = ['snapshot', 'compress', 'upload', 'manifest', 'download', 'unpack']

const unwrap = async (res: Response): Promise<{ ok: true; data: Snap } | { ok: false; error: string }> => {
  const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: Snap; error?: string } | null
  return j && j.ok && j.data?.state ? { ok: true, data: j.data } : { ok: false, error: j?.error || `HTTP ${res.status}` }
}

export function useBackup() {
  const [snap, setSnap] = useState<Snap | null>(null)
  const running = !!snap && RUNNING.includes(snap.state.phase)

  const load0 = useCallback(async () => {
    try {
      const r = await unwrap(await fetch('/api/settings/backup', { headers: authHeaders(), cache: 'no-store' }))
      if (r.ok) setSnap(r.data)
    } catch {
      /* try again on the next tick */
    }
  }, [])
  useEffect(() => {
    void load0()
  }, [load0])
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => void load0(), 1500)
    return () => clearInterval(t)
  }, [running, load0])

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

  /** the companies the channel holds (opens the sealed manifest with the passphrase); the list is also kept locally */
  const catalog = async (passphrase: string): Promise<Catalog | null> => {
    try {
      const res = await fetch('/api/settings/backup/catalog', { method: 'POST', headers: privilegedHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ passphrase }) })
      const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: Catalog; error?: string } | null
      if (j?.ok && j.data) {
        setSnap((s) => (s ? { ...s, catalog: j.data } : s))
        return j.data
      }
      toast.error(j?.error || `HTTP ${res.status}`)
    } catch {
      toast.error('Serverga ulanib boʻlmadi')
    }
    return null
  }

  /** bring the chosen companies from the channel into the live database */
  const load = async (passphrase: string, tins: string[]): Promise<boolean> => {
    try {
      const res = await fetch('/api/settings/backup/load', { method: 'POST', headers: privilegedHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ passphrase, tins }) })
      const r = await unwrap(res)
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

  return { snap, running, start, load, catalog, reload: load0 }
}
