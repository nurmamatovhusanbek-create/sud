'use client'

/**
 * Settings › Telegram: the operator's own bot (made with @BotFather) and the channel it is admin of. This is where encrypted copies of the
 * database will go. The token is typed once, stored on this computer only and never shown again; «Sinash» sends one tiny file, reads it
 * back and deletes it, so a working setup is proven before anything depends on it.
 */

import { useState } from 'react'
import { CheckCircle2, DatabaseBackup, Eye, FlaskConical, Play, Radar, RotateCcw, Send, Trash2, XCircle } from 'lucide-react'
import { useTelegram } from '@/hooks/use-telegram'
import { useBackup, useTelegramSearch } from '@/hooks/use-backup'
import { useWatch } from '@/hooks/use-watch'
import { useAutoBackup } from '@/hooks/use-auto-backup'
import { STEP_LABEL } from '@/core/telegram'
import { formatDmy } from '@/core/dates'

function BackupCard({ configured }: { configured: boolean }) {
  const { snap, running, start, load, catalog, reload } = useBackup()
  const auto = useAutoBackup()
  const [pass, setPass] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [reading, setReading] = useState(false)
  const [q, setQ] = useState('')
  const { result, searching } = useTelegramSearch(q)
  const st = snap?.state
  const last = snap?.last
  const ok = pass.length >= 10
  const go = async (kind: 'backup' | 'restore') => {
    if (kind === 'restore' && !window.confirm('Kanaldagi eng soʻnggi zaxira yuklab olinadi va sud.restored-….db nomi bilan joriy bazaning yoniga yoziladi. Joriy baza oʻzgarmaydi. Davom etasizmi?')) return
    if (await start(kind, pass)) setPass('')
    else void reload()
  }
  const companies = snap?.catalog?.companies ?? []
  const toggle = (tin: string) => setPicked((p) => (p.includes(tin) ? p.filter((t) => t !== tin) : [...p, tin]))
  const read = async () => {
    setReading(true)
    await catalog(pass)
    setReading(false)
  }
  const loadPicked = async () => {
    if (await load(pass, picked)) {
      setPass('')
      setPicked([])
    }
  }
  return (
    <div className="p-card rise-c" style={{ marginTop: 14 }}>
      <div className="card-h">
        <div className="ico"><DatabaseBackup /></div>
        <h2>Shifrlangan zaxira</h2>
        {last && <span className="badge" style={{ marginLeft: 'auto' }}>{last.created.slice(0, 10)} · {last.buckets ?? last.chunks} boʻlak{last.reused ? ` (${last.reused} ta oʻzgarmagan)` : ''}{last.pinned ? '' : ' · mahkamlanmagan'}{last.channels && last.channels.length > 1 ? ` · ${last.channels.filter((c) => c.ok).length}/${last.channels.length} kanal` : ''}</span>}
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
      <div className="p-row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        <button className="btn btn-outline" onClick={() => void read()} disabled={!configured || !ok || running || reading}>
          {reading ? <span className="spinner" /> : null}
          Kanaldagi kompaniyalar
        </button>
        {picked.length > 0 && (
          <button className="btn btn-primary" onClick={() => void loadPicked()} disabled={!ok || running}>
            Tanlanganlarni yuklash ({picked.length})
          </button>
        )}
      </div>
      {companies.length > 0 && (
        <div className="list" style={{ marginTop: 12 }}>
          {companies.map((c) => (
            <label className="kv" key={c.tin} style={{ cursor: 'pointer' }}>
              <span className="k" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={picked.includes(c.tin)} onChange={() => toggle(c.tin)} />
                <span className="mono">{c.tin}</span>
              </span>
              <span className="faint mono" style={{ fontSize: 12 }}>
                {c.bills} toʻlov · {c.found} ish{c.refreshedAt > 0 ? ` · ${formatDmy(new Date(c.refreshedAt))} holatiga` : ''}
              </span>
            </label>
          ))}
          <p className="faint" style={{ fontSize: 12, margin: '8px 0 0' }}>Tanlangan kompaniyalar joriy bazaga qoʻshiladi (yangiroq qatorlar saqlanadi); saytlarga soʻrov yuborilmaydi.</p>
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <label className="field" style={{ height: 40 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Telegram zaxirasidan qidirish: ish raqami, kvitansiya raqami yoki STIR…" spellCheck={false} style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }} />
        </label>
        {result && result.hits.length === 0 && !searching && (
          <p className="faint" style={{ fontSize: 12.5, margin: '8px 0 0' }}>
            {result.indexed === 0 ? 'Indeks hali yoʻq: «Kanaldagi kompaniyalar» ni bosing (zaxira yangi formatda boʻlishi kerak).' : `Topilmadi (${result.companies} ta kompaniyaning ${fmtN(result.indexed)} ta yozuvi ichidan).`}
          </p>
        )}
        {result && result.hits.length > 0 && (
          <div className="list" style={{ marginTop: 8 }}>
            {result.hits.map((h) => (
              <div className="kv" key={`${h.kind}-${h.key}-${h.tin}`}>
                <span className="k" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span className="badge">{h.kind === 'case' ? 'Ish' : h.kind === 'bill' ? 'Kvitansiya' : 'Kompaniya'}</span>
                  <b className="mono">{h.key}</b>
                </span>
                <span className="faint mono" style={{ fontSize: 12 }}>
                  {h.kind === 'company' ? `${h.bills ?? 0} toʻlov · ${h.found ?? 0} ish` : `${h.kind === 'bill' && h.caseNumber ? `ish ${h.caseNumber} · ` : ''}STIR ${h.tin}${h.court ? ` · ${h.court}` : ''}${h.year ? ` · ${h.kind === 'case' ? `20${h.year}` : h.year}` : ''}`}
                  {' · '}
                  {h.loaded ? 'bazada bor' : 'Telegramda'}
                </span>
                {!h.loaded && (
                  <button className="btn btn-outline btn-sm" onClick={() => toggle(h.tin)}>{picked.includes(h.tin) ? 'Tanlandi' : 'Yuklash uchun tanlash'}</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="p-row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
        {auto.status?.enabled ? (
          <button className="btn btn-outline" onClick={() => void auto.disable()} disabled={auto.busy}>Avtomatik zaxirani oʻchirish</button>
        ) : (
          <button className="btn btn-outline" onClick={() => void auto.enable(pass)} disabled={!configured || !ok || auto.busy}>
            {auto.busy ? <span className="spinner" /> : null}
            Avtomatik zaxirani yoqish
          </button>
        )}
        <span className={`badge ${auto.status?.enabled ? 'b-pos' : ''}`}>{auto.status?.enabled ? 'avtomatik zaxira yoqilgan' : 'avtomatik zaxira oʻchiq'}</span>
      </div>
      <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '8px 0 0' }}>
        Yoqilsa, bazada yangi narsa paydo boʻlganda (yangi kvitansiya, topilgan ish, oʻzgargan holat) zaxira kanalga oʻzi yuboriladi va bot 5 daqiqa ichida koʻradi.
        Buning uchun parol <b>shu kompyuterda</b> shaxsiy faylda (<span className="mono">~/.sud-tizimi/backup-pass.json</span>) saqlanadi: botning tokeni kabi, gitga tushmaydi va brauzerga qaytarilmaydi; oʻchirsangiz fayl ham oʻchadi.
        Parol avval kanaldagi zaxira bilan solishtiriladi. Tekshiruv har 5 daqiqada, zaxira 15 daqiqadan tez-tez emas; bills jarayoni yoki Kuzatuv ishlayotganda kutadi; xato boʻlsa pauza bilan qayta uriniladi.
      </p>
      {auto.status?.enabled && (auto.status.lastOkAt > 0 || auto.status.lastError) && (
        <div className="list" style={{ marginTop: 10 }}>
          {auto.status.lastOkAt > 0 && (
            <div className="kv"><span className="k">Soʻnggi avtomatik zaxira</span><span className="faint" style={{ fontSize: 12.5 }}>{formatDmy(new Date(auto.status.lastOkAt))} {new Date(auto.status.lastOkAt).toTimeString().slice(0, 5)}</span></div>
          )}
          {auto.status.lastError && <div className="kv"><span className="k" style={{ color: 'var(--neg-text)' }}>{auto.status.lastError}{auto.status.failures > 1 ? ` (${auto.status.failures} marta)` : ''}</span></div>}
        </div>
      )}
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

const fmtN = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')

const splitList = (s: string): string[] => s.split(/[\s,;]+/).filter(Boolean)

/** Kuzatuv: the app reads the court lists by itself every few hours and tells the recipients on Telegram what is new. Off until the operator switches it on. */
function WatchCard({ configured }: { configured: boolean }) {
  const { snap, busy, save, run, test } = useWatch()
  const [ids, setIds] = useState<string | null>(null)
  const [tins, setTins] = useState<string | null>(null)
  const [hours, setHours] = useState<string | null>(null)
  const cfg = snap?.config
  const last = snap?.last
  const idsNow = ids ?? cfg?.recipients.join(', ') ?? ''
  const tinsNow = tins ?? cfg?.tins?.join(', ') ?? ''
  const hoursNow = hours ?? String(cfg?.intervalHours ?? 6)
  const dirty = ids !== null || tins !== null || hours !== null
  const apply = async () => {
    const recipients = splitList(idsNow).map(Number)
    const list = splitList(tinsNow)
    const ok = await save({ recipients, tins: list.length ? list : null, intervalHours: Number(hoursNow) })
    if (ok) {
      setIds(null)
      setTins(null)
      setHours(null)
    }
  }
  const at = (ms: number): string => `${formatDmy(new Date(ms))} ${new Date(ms).toTimeString().slice(0, 5)}`
  return (
    <div className="p-card rise-c" style={{ marginTop: 14 }}>
      <div className="card-h">
        <div className="ico"><Eye /></div>
        <h2>Kuzatuv (avtomatik)</h2>
        {cfg && <span className={`badge ${cfg.enabled ? 'b-pos' : ''}`} style={{ marginLeft: 'auto' }}>{cfg.enabled ? `yoqilgan · ${snap?.watching.length ?? 0} kompaniya` : 'oʻchiq'}</span>}
      </div>
      <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '2px 0 12px' }}>
        Yoqilsa, ilova kompaniyalarning sud roʻyxatlarini har bir necha soatda oʻzi qayta oʻqiydi va yangilikni Telegram orqali yuboradi: <b>yangi ariza</b>, <b>apellyatsiya / kassatsiya / nazorat
        instansiyasi</b>, <b>majlis sanasi oʻzgargani</b>, <b>ish holati oʻzgargani</b>. Xabarda kompaniya daʼvogar yoki javobgar ekani, tomonlar nomi va STIRi, holati va muddati boʻladi.
        Birinchi oʻqish faqat eslab qoladi va xabar yubormaydi. Kompyuter yoqilgan va ilova ishlab turishi kerak (<span className="mono">Sud.bat keep</span>). Roʻyxatlar 100–200 qatorgacha qirqilishi mumkin.
        Xabar yuborilmasa yoki oluvchi boʻlmasa, yangilik eslab qolinmaydi va keyingi safar qayta uriniladi.
      </p>
      {!configured && <p className="faint" style={{ fontSize: 12.5, margin: '0 0 12px' }}>Avval yuqorida bot tokenini saqlang: xabarlar shu bot orqali ketadi.</p>}
      <div style={{ display: 'grid', gap: 10 }}>
        <label className="field" style={{ height: 40 }}>
          <input value={idsNow} onChange={(e) => setIds(e.target.value)} placeholder="Xabar oluvchilar: Telegram ID (vergul bilan, 10 tagacha)" spellCheck={false} style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }} />
        </label>
        <label className="field" style={{ height: 40 }}>
          <input value={tinsNow} onChange={(e) => setTins(e.target.value)} placeholder="Kompaniyalar (STIR, vergul bilan): boʻsh = bazadagi hammasi" spellCheck={false} style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }} />
        </label>
        <label className="field" style={{ height: 40 }}>
          <input value={hoursNow} onChange={(e) => setHours(e.target.value)} inputMode="numeric" placeholder="Necha soatda bir (1–48)" spellCheck={false} style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }} />
        </label>
      </div>
      <div className="p-row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
        {cfg && (
          <button className={`btn ${cfg.enabled ? 'btn-outline' : 'btn-primary'}`} onClick={() => void save({ enabled: !cfg.enabled })} disabled={!!busy || (!cfg.enabled && !cfg.recipients.length && !splitList(idsNow).length)}>
            {busy === 'save' ? <span className="spinner" /> : null}
            {cfg.enabled ? 'Oʻchirish' : 'Yoqish'}
          </button>
        )}
        <button className="btn btn-outline" onClick={() => void apply()} disabled={!dirty || !!busy}>Saqlash</button>
        <button className="btn btn-outline" onClick={() => void test()} disabled={!configured || !!busy || !cfg?.recipients.length}>
          {busy === 'test' ? <span className="spinner" /> : <FlaskConical />}
          Sinash
        </button>
        <button className="btn btn-outline" onClick={() => void run()} disabled={!configured || !!busy || !!snap?.running || !cfg?.recipients.length}>
          {snap?.running || busy === 'run' ? <span className="spinner" /> : <Play />}
          Hozir tekshirish
        </button>
      </div>
      {(last || snap?.nextAt) && (
        <div className="list" style={{ marginTop: 14 }}>
          {last && (
            <div className="kv">
              <span className="k">Soʻnggi tekshiruv: {at(last.at)}</span>
              <span className="faint" style={{ fontSize: 12.5 }}>
                {fmtN(last.companies)} kompaniya · {fmtN(last.rows)} qator · {fmtN(last.events)} yangilik · {fmtN(last.sent)} xabar{last.baselines ? ` · ${fmtN(last.baselines)} ta birinchi oʻqish` : ''}
              </span>
            </div>
          )}
          {snap?.nextAt && cfg?.enabled && <div className="kv"><span className="k">Keyingisi</span><span className="faint" style={{ fontSize: 12.5 }}>{snap.running ? 'hozir oʻqilmoqda' : at(snap.nextAt)}</span></div>}
          {last?.errors.slice(0, 5).map((e, i) => (
            <div className="kv" key={i}><span className="k faint" style={{ fontSize: 12.5 }}>{e}</span></div>
          ))}
        </div>
      )}
    </div>
  )
}

export function TelegramTab() {
  const { status, busy, out, channels, find, test, save, forget } = useTelegram()
  const [token, setToken] = useState('')
  const [chat, setChat] = useState('')
  const [mirrors, setMirrors] = useState<string | null>(null) // null = untouched: the saved mirrors stay
  const mirrorFirst = (mirrors ?? status?.mirrors.join(' ') ?? '').split(/[\s,;]+/).find(Boolean) ?? ''
  const chatNow = chat.trim() || status?.chat || ''
  const haveToken = !!token.trim() || !!status?.configured

  return (
    <div className="dash" style={{ gridTemplateColumns: '1fr' }}>
      <div className="p-card rise-c">
        <div className="card-h">
          <div className="ico"><Send /></div>
          <h2>Telegram (zaxira kanali)</h2>
          {status?.configured && <span className="badge b-pos" style={{ marginLeft: 'auto' }}>{status.chat}{status.mirrors.length ? ` + ${status.mirrors.length} zaxira` : ''} · {status.tokenHint}</span>}
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
          <label className="field" style={{ height: 40 }}>
            <input
              value={mirrors ?? ''}
              onChange={(e) => setMirrors(e.target.value)}
              placeholder={status?.mirrors.length ? `Zaxira kanallar (${status.mirrors.join(', ')}): oʻzgartirish uchun yozing, tozalash uchun boʻsh joy` : 'Zaxira kanal (ixtiyoriy, 3 tagacha, vergul bilan): @nom yoki -100…'}
              spellCheck={false}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
            />
          </label>
          <p className="faint" style={{ fontSize: 12, lineHeight: 1.5, margin: 0 }}>
            Zaxira kanal: har bir zaxira asosiy kanalga ham, shu kanallarga ham alohida joylanadi (har birida oʻz manifesti). Asosiy kanal bloklansa yoki manifest xabari
            oʻchib ketsa, oʻqish (tiklash, kompaniyalarni yuklash, qidiruv) avtomatik zaxira kanaldan davom etadi. Botni zaxira kanalga ham admin qiling. Botdagi
            <span className="mono"> SUD_CHANNEL</span> ga ham vergul bilan yozing.
          </p>
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
          {mirrorFirst && (
            <button className="btn btn-outline" onClick={() => void test(token, mirrorFirst)} disabled={!haveToken || !!busy}>
              <FlaskConical />
              Zaxira kanalni sinash
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => void save(token, chatNow, mirrors).then((ok) => ok && (setToken(''), setChat(''), setMirrors(null)))}
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
      <WatchCard configured={!!status?.configured} />
    </div>
  )
}
