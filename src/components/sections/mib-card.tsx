'use client'

/**
 * MIB (Ijro qarzdorligi) — a compact status tile for the Statistika KPI row
 * (MibMini) that opens the full detail in a drawer (MibDetail).
 *
 * The operator opens the fast «Qarzdorlikni tekshirish» service on mib.uz in
 * their own browser (a UZ IP — no geo-block), solves the captcha, selects-all
 * and copies the result, and pastes it into the drawer. The server parses it
 * (never renders it) and we cache the structured debts into the company
 * registry so the watchlist can flag debtors. Manual + on-demand, with refresh.
 */

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, Copy, ClipboardCheck, RefreshCw, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { parseMibDebt } from '@/lib/api-client'
import { patchMeta, getRecord } from '@/lib/registry'
import { useRegistryVersion } from '@/lib/use-registry'
import { openProtoDrawer } from '@/components/proto/drawer'
import type { MibDebt } from '@/lib/mib-types'

const MIB_URL = 'https://mib.uz/bl'
const MAX_PASTE = 4 * 1024 * 1024

function money(n: number | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' soʻm'
}
function whenChecked(ts: number | undefined): string {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

function DebtRow({ d }: { d: MibDebt }) {
  return (
    <div className="lrow" style={{ cursor: 'default', alignItems: 'flex-start' }}>
      <div className="lead"><ShieldAlert /></div>
      <div className="main-c" style={{ minWidth: 0 }}>
        <b className="mono">{d.enforcementCaseNumber}</b>
        <div className="sub">
          {d.subject}
          {d.department && d.department !== '—' ? ` · ${d.department}` : ''}
          {d.collector && d.collector !== '—' ? ` · ${d.collector}` : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
        <b className="mono" style={{ fontSize: 13, color: 'var(--neg-text)' }}>{money(d.amount)}</b>
        {d.status && d.status !== '—' && <div className="faint" style={{ fontSize: 11 }}>{d.status}</div>}
      </div>
    </div>
  )
}

/** Full detail — used inside the drawer. Reads the cached result and lets the
 *  operator paste a fresh mib.uz result to (re)check. */
export function MibDetail({ stir }: { stir: string }) {
  useRegistryVersion()
  const meta = getRecord(stir)?.meta
  const checked = meta?.mibCheckedAt != null
  const hasDebt = !!meta?.mibHasDebt
  const debts = meta?.mibDebts ?? []

  const [open, setOpen] = useState(!checked) // unchecked → show the check flow straight away
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyStir = () => {
    void navigator.clipboard?.writeText(stir).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const submit = async () => {
    const html = paste.trim()
    if (!html) { toast.error('Avval MIB natijasini joylang'); return }
    if (html.length > MAX_PASTE) { toast.error('Matn juda katta'); return }
    setBusy(true)
    try {
      const res = await parseMibDebt(stir, html)
      if (!res.ok) { toast.error(res.error); return }
      const r = res.data
      if (r.status === 'error') { toast.error(r.message || 'MIB natijasi oʻqilmadi'); return }
      patchMeta(stir, {
        mibHasDebt: r.hasDebt,
        mibTotalDebt: r.totalDebt ?? (r.debts?.reduce((a, d) => a + d.amount, 0) || 0),
        mibCurrentDebt: r.currentDebt,
        mibDebts: r.debts ?? [],
        mibCheckedAt: r.checkedAt,
      })
      toast.success(r.hasDebt ? `Qarzdorlik topildi: ${r.debts?.length ?? 0} ta ijro ishi` : 'Qarzdorlik aniqlanmadi')
      setPaste('')
      setOpen(false)
    } catch {
      toast.error('Natijani oʻqib boʻlmadi')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="p-row" style={{ gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {checked && (
          hasDebt
            ? <span className="badge b-neg" style={{ height: 28 }}><AlertTriangle />Qarzdor</span>
            : <span className="badge b-pos" style={{ height: 28 }}><CheckCircle2 />Qarzdorlik yoʻq</span>
        )}
        {checked && <span className="faint" style={{ fontSize: 12 }}>Soʻnggi tekshiruv: {whenChecked(meta?.mibCheckedAt)}</span>}
        <div style={{ flex: 1 }} />
        <button className="btn btn-outline btn-sm" onClick={() => setOpen((o) => !o)}>
          <RefreshCw />{checked ? 'Qayta tekshirish' : 'Tekshirish'}
        </button>
      </div>

      {checked && hasDebt && (
        <>
          <div className="mib-tot">
            <div><span className="lbl">Umumiy qarzdorlik</span><b className="mono">{money(meta?.mibTotalDebt)}</b></div>
            {meta?.mibCurrentDebt != null && (
              <div><span className="lbl">Joriy</span><b className="mono">{money(meta?.mibCurrentDebt)}</b></div>
            )}
            <div><span className="lbl">Ijro ishlari</span><b className="mono">{debts.length}</b></div>
          </div>
          <div className="list" style={{ marginTop: 4 }}>
            {debts.map((d) => <DebtRow key={d.enforcementCaseNumber} d={d} />)}
          </div>
        </>
      )}
      {checked && !hasDebt && !open && (
        <div className="faint" style={{ fontSize: 12.5, padding: '4px 2px' }}>
          Oxirgi tekshiruvda ijro qarzdorligi topilmadi.
        </div>
      )}

      {open && (
        <div className="mib-flow">
          <ol className="mib-steps">
            <li>
              <span>mib.uz «Qarzdorlikni tekshirish» sahifasini oching, STIR ni kiriting va rasmdagi kodni yeching.</span>
              <div className="p-row" style={{ gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <a className="btn btn-primary btn-sm" href={MIB_URL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />mib.uz ochish
                </a>
                <button className="btn btn-outline btn-sm" onClick={copyStir}>
                  {copied ? <ClipboardCheck /> : <Copy />}<span>STIR: {stir}</span>
                </button>
              </div>
            </li>
            <li>
              <span>Natija sahifasini belgilang (Ctrl+A), nusxa oling (Ctrl+C) va shu yerga joylang.</span>
              <textarea
                className="dinput"
                style={{ marginTop: 6, minHeight: 96 }}
                placeholder="MIB natija sahifasi mazmunini shu yerga joylang…"
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
              />
            </li>
          </ol>
          <div className="p-row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            {checked && <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setPaste('') }}>Bekor qilish</button>}
            <button className="btn btn-primary btn-sm" onClick={() => void submit()} disabled={busy || !paste.trim()}>
              {busy ? <span className="spinner" /> : <ClipboardCheck />}<span>Natijani oʻqish</span>
            </button>
          </div>
          <div className="faint" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.4 }}>
            Tekshiruv sizning brauzeringiz (O‘zbekiston IP) orqali amalga oshiriladi — server mib.uz ga ulanmaydi va sahifa mazmuni saqlanmaydi.
          </div>
        </div>
      )}
    </div>
  )
}

export function openMibDrawer(stir: string) {
  openProtoDrawer('Ijro qarzdorligi · MIB', <MibDetail stir={stir} />, `STIR ${stir}`)
}

/** Statistika card (beside the «Oylik faollik» chart) — a status summary that
 *  opens the full check/detail drawer. Always shown, even with no debt. */
export function MibCard({ stir }: { stir: string }) {
  useRegistryVersion()
  const meta = getRecord(stir)?.meta
  const checked = meta?.mibCheckedAt != null
  const hasDebt = !!meta?.mibHasDebt
  const count = meta?.mibDebts?.length ?? 0
  const open = () => openMibDrawer(stir)

  return (
    <div className={`p-card rise-c mib-card${hasDebt ? ' has-debt' : ''}`}>
      <div className="card-h">
        <div className="ico"><ShieldAlert /></div>
        <h3>Ijro qarzdorligi</h3>
        <div className="sp" />
        {checked && (
          hasDebt
            ? <span className="badge b-neg"><AlertTriangle />Qarzdor</span>
            : <span className="badge b-pos"><CheckCircle2 />Yoʻq</span>
        )}
      </div>

      {!checked ? (
        <div className="mib-body">
          <div className="mib-icowrap"><ShieldAlert /></div>
          <div className="mib-lead">Hali tekshirilmagan</div>
          <p className="faint">MIB (Majburiy ijro byurosi) orqali ijro qarzdorligini qoʻlda tekshiring.</p>
          <button className="btn btn-primary btn-sm" onClick={open}><RefreshCw />Tekshirish</button>
        </div>
      ) : hasDebt ? (
        <div className="mib-body mib-body-debt">
          <div className="mib-total mono">{money(meta?.mibTotalDebt)}</div>
          <div className="faint">{count} ta ijro ishi boʻyicha qarzdorlik</div>
          <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>Soʻnggi tekshiruv: {whenChecked(meta?.mibCheckedAt)}</div>
          <button className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={open}><ShieldAlert />Batafsil koʻrish</button>
        </div>
      ) : (
        <div className="mib-body">
          <div className="mib-icowrap mib-ok"><CheckCircle2 /></div>
          <div className="mib-lead">Qarzdorlik yoʻq</div>
          <p className="faint">Oxirgi tekshiruvda ijro qarzdorligi topilmadi.<br />Soʻnggi tekshiruv: {whenChecked(meta?.mibCheckedAt)}</p>
          <button className="btn btn-outline btn-sm" onClick={open}><RefreshCw />Qayta tekshirish</button>
        </div>
      )}
    </div>
  )
}
