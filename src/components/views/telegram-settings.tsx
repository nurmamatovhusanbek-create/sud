'use client'

/**
 * Settings › Telegram: the operator's own bot (made with @BotFather) and the channel it is admin of. This is where encrypted copies of the
 * database will go. The token is typed once, stored on this computer only and never shown again; «Sinash» sends one tiny file, reads it
 * back and deletes it, so a working setup is proven before anything depends on it.
 */

import { useState } from 'react'
import { CheckCircle2, DatabaseBackup, FlaskConical, Radar, RotateCcw, Send, Trash2, XCircle } from 'lucide-react'
import { useTelegram } from '@/hooks/use-telegram'
import { useBackup } from '@/hooks/use-backup'
import { STEP_LABEL } from '@/core/telegram'

function BackupCard({ configured }: { configured: boolean }) {
  const { snap, running, start, reload } = useBackup()
  const [pass, setPass] = useState('')
  const st = snap?.state
  const last = snap?.last
  const ok = pass.length >= 10
  const go = async (kind: 'backup' | 'restore') => {
    if (kind === 'restore' && !window.confirm('Kanaldagi eng soʻnggi zaxira yuklab olinadi va sud.restored-….db nomi bilan joriy bazaning yoniga yoziladi. Joriy baza oʻzgarmaydi. Davom etasizmi?')) return
    if (await start(kind, pass)) setPass('')
    else void reload()
  }
  return (
    <div className="p-card rise-c" style={{ marginTop: 14 }}>
      <div className="card-h">
        <div className="ico"><DatabaseBackup /></div>
        <h2>Shifrlangan zaxira</h2>
        {last && <span className="badge" style={{ marginLeft: 'auto' }}>{last.created.slice(0, 10)} · {last.buckets ?? last.chunks} boʻlak{last.reused ? ` (${last.reused} ta oʻzgarmagan)` : ''}{last.pinned ? '' : ' · mahkamlanmagan'}</span>}
      </div>
      <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '2px 0 12px' }}>
        Baza kompaniya va yil boʻyicha boʻlaklarga ajratiladi; har bir boʻlak siqiladi, parolingiz bilan AES-256 yordamida shifrlanadi va kanalga joylanadi.
        Keyingi zaxirada faqat oʻzgargan boʻlaklar yuboriladi (hech narsa oʻchirilmaydi, eski manifestlar tarix boʻlib qoladi); soʻnggi manifest mahkamlanadi. Telegram faqat tasodifiy baytlarni va maʼnosiz fayl nomlarini koʻradi. Har safar <b>bir xil parol</b> kiriting. <b>Parol hech qayerda saqlanmaydi: yoʻqotsangiz zaxirani ochib boʻlmaydi.</b> Yangi kompyuterda botni, kanalni va parolni kiritib «Tiklash» ni bosing.
      </p>
      <label className="field" style={{ height: 40 }}>
        <input type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Zaxira paroli (kamida 10 belgi)" spellCheck={false} style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }} />
      </label>
      <div className="p-row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
        <button className="btn btn-primary" onClick={() => void go('backup')} disabled={!configured || !ok || running}>
          {running && st?.kind === 'backup' ? <span className="spinner" /> : <DatabaseBackup />}
          Zaxiralash
        </button>
        <button className="btn btn-outline" onClick={() => void go('restore')} disabled={!configured || !ok || running}>
          {running && st?.kind === 'restore' ? <span className="spinner" /> : <RotateCcw />}
          Tiklash
        </button>
      </div>
      {!configured && <p className="faint" style={{ fontSize: 12.5, margin: '10px 0 0' }}>Avval yuqorida botni va kanalni saqlang.</p>}
      {st && st.phase !== 'idle' && (
        <div className="kv" style={{ marginTop: 14 }}>
          <span className="k" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {st.phase === 'done' ? <CheckCircle2 size={16} /> : st.phase === 'error' ? <XCircle size={16} /> : <span className="spinner" />}
            {st.message}
          </span>
          {st.total > 1 && running && <span className="badge">{st.done}/{st.total}</span>}
        </div>
      )}
      {st?.phase === 'done' && st.result?.restoredFile && <div className="faint mono" style={{ fontSize: 12, marginTop: 6, wordBreak: 'break-all' }}>{st.result.restoredFile}</div>}
    </div>
  )
}

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
      <BackupCard configured={!!status?.configured} />
    </div>
  )
}
