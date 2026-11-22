'use client'

/** Settings › Maʼlumotlar bazasi: the database's status and its three actions (download, compact, forget one company). */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { authHeaders, downloadDatabase, privilegedHeaders } from '@/lib/api-client'
import { fmtInt } from '@/lib/report/model'
import type { DbStatus } from '@/lib/db-admin'

const unwrap = async <T,>(res: Response): Promise<{ ok: true; data: T } | { ok: false; error: string }> => {
  const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: string } | null
  return j && j.ok && j.data ? { ok: true, data: j.data } : { ok: false, error: j?.error || `HTTP ${res.status}` }
}

export const sizeText = (b: number): string => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`)

export function useDbAdmin() {
  const [st, setSt] = useState<DbStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await unwrap<DbStatus>(await fetch('/api/settings/db', { headers: authHeaders(), cache: 'no-store' }))
      if (r.ok && r.data.tables && Array.isArray(r.data.companies)) setSt(r.data)
    } catch {
      /* the buttons still work */
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const download = async () => {
    setBusy('download')
    try {
      await downloadDatabase()
      toast.success('Baza yuklab olindi')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Yuklab boʻlmadi')
    } finally {
      setBusy(null)
    }
  }
  const compact = async () => {
    setBusy('compact')
    try {
      const r = await unwrap<{ before: number; after: number }>(await fetch('/api/settings/db/compact', { method: 'POST', headers: privilegedHeaders() }))
      if (r.ok) toast.success(`Siqildi: ${sizeText(r.data.before)} → ${sizeText(r.data.after)}`)
      else toast.error(r.error)
    } catch {
      toast.error('Serverga ulanib boʻlmadi')
    } finally {
      setBusy(null)
      void load()
    }
  }
  const forget = async (tin: string) => {
    if (!window.confirm(`${tin}: shu kompaniyaning saqlangan toʻlovlari, topilgan ishlari va urinilgan raqamlari oʻchiriladi (ish tafsilotlari qoladi). Davom etasizmi?`)) return
    setBusy(tin)
    try {
      const r = await unwrap<{ bills: number; found: number; tried: number }>(
        await fetch(`/api/settings/db/forget?tin=${encodeURIComponent(tin)}`, { method: 'POST', headers: privilegedHeaders() }),
      )
      if (r.ok) toast.success(`Oʻchirildi: ${fmtInt(r.data.bills)} toʻlov, ${fmtInt(r.data.found)} ish`)
      else toast.error(r.error)
    } catch {
      toast.error('Serverga ulanib boʻlmadi')
    } finally {
      setBusy(null)
      void load()
    }
  }
  return { st, busy, download, compact, forget }
}
