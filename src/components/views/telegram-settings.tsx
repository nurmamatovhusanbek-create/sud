'use client'

/**
 * Settings › Telegram: the operator's own bot (made with @BotFather) and the channel it is admin of. This is where encrypted copies of the
 * database will go. The token is typed once, stored on this computer only and never shown again; «Sinash» sends one tiny file, reads it
 * back and deletes it, so a working setup is proven before anything depends on it.
 */

import { useState } from 'react'
import { CheckCircle2, FlaskConical, Radar, Send, Trash2, XCircle } from 'lucide-react'
import { useTelegram } from '@/hooks/use-telegram'
import { STEP_LABEL } from '@/core/telegram'

export function TelegramTab() {
  const { status, busy, out, channels, find, test, save, forget } = useTelegram()
  const [token, setToken] = useState('')
  const [chat, setChat] = useState('')
  const chatNow = chat.trim() || status?.chat || ''
  const haveToken = !!token.trim() || !!status?.configured

  return (
    <div className="dash" style={{ gridTemplateColumns: '1fr' }}>
      <div className="p-card rise-c">
        <div className="card-h">
          <div className="ico"><Send /></div>
          <h2>Telegram (zaxira kanali)</h2>
          {status?.configured && <span className="badge b-pos" style={{ marginLeft: 'auto' }}>{status.chat} · {status.tokenHint}</span>}
        </div>
        <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '2px 0 12px' }}>
          Bazaning shifrlangan nusxalari oʻz Telegram kanalingizga joylanadi. @BotFather orqali bot yarating, kanalni yarating va botni unga admin qiling
          («Post messages» huquqi bilan). Token faqat shu kompyuterda (<span className="mono">~/.sud-tizimi/telegram.json</span>) saqlanadi, brauzerga qaytarilmaydi va hech qachon gitga tushmaydi.
          Sinov kanalga bitta kichik fayl yuboradi, qaytarib oladi, solishtiradi va oʻchiradi.
        </p>

        <div style={{ display: 'grid', gap: 10 }}>
          <label className="field" style={{ height: 40 }}>
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={status?.configured ? `Bot tokeni (${status.tokenHint}) — oʻzgartirmaslik uchun boʻsh qoldiring` : 'Bot tokeni: 123456789:AA…'}
              spellCheck={false}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
            />
          </label>
          <label className="field" style={{ height: 40 }}>
            <input value={chat} onChange={(e) => setChat(e.target.value)} placeholder={status?.chat ? `Kanal (${status.chat})` : 'Kanal: @nom yoki -100… raqami'} spellCheck={false} style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }} />
          </label>
        </div>

        {channels && channels.length > 0 && (
          <div className="list" style={{ marginTop: 12 }}>
            {channels.map((c) => (
              <div className="kv" key={c.id}>
                <span className="k"><b>{c.title || c.id}</b> <span className="faint mono" style={{ fontSize: 12 }}>{c.username || c.id}</span></span>
                <button className="btn btn-outline btn-sm" onClick={() => setChat(c.id)}>Tanlash</button>
              </div>
            ))}
          </div>
        )}

        <div className="p-row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          <button className="btn btn-outline" onClick={() => void find(token)} disabled={!haveToken || !!busy}>
            {busy === 'find' ? <span className="spinner" /> : <Radar />}
            Kanalni topish
          </button>
          <button className="btn btn-outline" onClick={() => void test(token, chatNow)} disabled={!haveToken || !chatNow || !!busy}>
            {busy === 'test' ? <span className="spinner" /> : <FlaskConical />}
            Sinash
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void save(token, chatNow).then((ok) => ok && (setToken(''), setChat('')))}
            disabled={!haveToken || !chatNow || !!busy}
          >
            {busy === 'save' ? <span className="spinner" /> : null}
            {status?.configured ? 'Yangilash' : 'Saqlash'}
          </button>
          {status?.configured && (
            <button className="btn btn-outline" onClick={() => void forget()} disabled={!!busy} aria-label="Botni unutish">
              <Trash2 />
            </button>
          )}
        </div>

        {out && (
          <div className="list" style={{ marginTop: 14 }}>
            {out.steps.map((s) => (
              <div className="kv" key={s.step}>
                <span className="k" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {s.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                  {STEP_LABEL[s.step]}
                </span>
                <span className="faint" style={{ fontSize: 12.5 }}>{s.note}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
