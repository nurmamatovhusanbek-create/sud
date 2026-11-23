'use client'

/** Settings › Telegram: the saved bot's status and its actions (find the channel, test, save, forget). The token is typed here and sent to this server only. */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { authHeaders, privilegedHeaders } from '@/lib/api-client'
import type { TelegramStepResult } from '@/core/telegram'

export interface TgStatus {
  configured: boolean
  chat: string
  mirrors: string[]
  tokenHint: string
}
export interface TgTest {
  ok: boolean
  steps: TelegramStepResult[]
  botUsername: string
  chatTitle: string
  chatId: string
}
export interface TgChannel {
  id: string
  title: string
  username: string
}

const unwrap = async <T,>(res: Response): Promise<{ ok: true; data: T } | { ok: false; error: string }> => {
  const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: string } | null
  return j && j.ok && j.data ? { ok: true, data: j.data } : { ok: false, error: j?.error || `HTTP ${res.status}` }
}

const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: privilegedHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) })

export function useTelegram() {
  const [status, setStatus] = useState<TgStatus | null>(null)
  const [busy, setBusy] = useState<'find' | 'test' | 'save' | null>(null)
  const [out, setOut] = useState<TgTest | null>(null)
  const [channels, setChannels] = useState<TgChannel[] | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await unwrap<TgStatus>(await fetch('/api/settings/telegram', { headers: authHeaders(), cache: 'no-store' }))
      if (r.ok && typeof r.data.configured === 'boolean') setStatus(r.data)
    } catch {
      /* the form still works without it */
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const find = async (token: string) => {
    setBusy('find')
    setChannels(null)
    try {
      const r = await unwrap<{ channels: TgChannel[] }>(await post('/api/settings/telegram/find', { token }))
      if (!r.ok || !Array.isArray(r.data.channels)) toast.error(r.ok ? 'Javob shakli notoʻgʻri' : r.error)
      else {
        setChannels(r.data.channels)
        if (!r.data.channels.length) toast.message('Kanal topilmadi: botni kanalga admin qiling va kanalga istalgan xabar yozing, soʻng qayta urining')
      }
    } catch {
      toast.error('Serverga ulanib boʻlmadi')
    } finally {
      setBusy(null)
    }
  }

  const test = async (token: string, chat: string) => {
    setBusy('test')
    setOut(null)
    const id = toast.loading('Telegram sinalmoqda…')
    try {
      const r = await unwrap<TgTest>(await post('/api/settings/telegram/test', { token, chat }))
      if (!r.ok || !Array.isArray(r.data.steps)) {
        toast.error(r.ok ? 'Javob shakli notoʻgʻri' : r.error, { id })
        return
      }
      setOut(r.data)
      if (r.data.ok) toast.success('Telegram ishlayapti: fayl yuborildi va qaytarib olindi', { id })
      else toast.error(r.data.steps.find((s) => !s.ok)?.note ?? 'Sinov oʻtmadi', { id })
    } catch {
      toast.error('Sinovni oʻtkazib boʻlmadi', { id })
    } finally {
      setBusy(null)
    }
  }

  /** `mirrors`: null keeps the saved mirror channels; a text («@a, -100…») replaces them (empty clears) */
  const save = async (token: string, chat: string, mirrors: string | null = null): Promise<boolean> => {
    setBusy('save')
    try {
      const r = await unwrap<TgStatus>(await post('/api/settings/telegram', mirrors === null ? { token, chat } : { token, chat, mirrors }))
      if (r.ok) {
        setStatus(r.data)
        toast.success('Saqlandi')
        return true
      }
      toast.error(`Saqlanmadi: ${r.error}`)
    } catch {
      toast.error('Saqlab boʻlmadi')
    } finally {
      setBusy(null)
    }
    return false
  }

  const forget = async () => {
    try {
      const r = await unwrap<TgStatus>(await fetch('/api/settings/telegram', { method: 'DELETE', headers: privilegedHeaders() }))
      if (r.ok) {
        setStatus(r.data)
        setOut(null)
        toast.success('Oʻchirildi')
      }
    } catch {
      toast.error('Oʻchirib boʻlmadi')
    }
  }

  return { status, busy, out, channels, find, test, save, forget }
}
