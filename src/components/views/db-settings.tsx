'use client'

/**
 * Settings › Maʼlumotlar bazasi: what `sud.db` holds (bills, found cases, case details), its size, a copy to DOWNLOAD (never copied to another
 * folder by the app), compacting, and forgetting one company. Nothing here asks a site for anything.
 */

import { Database, Download, Minimize2, Trash2 } from 'lucide-react'
import { sizeText as mb, useDbAdmin } from '@/hooks/use-db-admin'

const fmtInt = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')
const COURT: Record<string, string> = { economic: 'Iqtisodiy', civil: 'Fuqarolik', administrative: 'Maʼmuriy', criminal: 'Jinoyat' }

export function DbTab() {
  const { st, busy, download, compact, forget } = useDbAdmin()

  return (
    <div className="dash" style={{ gridTemplateColumns: '1fr' }}>
      <div className="p-card rise-c">
        <div className="card-h">
          <div className="ico"><Database /></div>
          <div className="h">Maʼlumotlar bazasi</div>
          {st && <span className="badge" style={{ marginLeft: 'auto' }}>{mb(st.bytes)}</span>}
        </div>
        <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '2px 0 12px' }}>
          Toʻlovlar, toʻlovlar orqali topilgan ishlar va ish tafsilotlari bitta SQLite faylda (<span className="mono">~/.sud-tizimi/sud.db</span>) saqlanadi.
          Nusxa ilova ishlayotganda ham xavfsiz olinadi va brauzer orqali yuklab olinadi. Qayta tiklash: ilovani yoping, faylni shu joyga qoʻying.
        </p>
        {st?.recovery && <p className="faint" style={{ fontSize: 12.5, margin: '0 0 12px' }}>{st.recovery}</p>}
        <div className="p-row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <button className="btn btn-primary btn-sm" onClick={() => void download()} disabled={!!busy}>
            <Download /> {busy === 'download' ? 'Tayyorlanmoqda…' : 'Bazani yuklab olish'}
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => void compact()} disabled={!!busy}>
            <Minimize2 /> {busy === 'compact' ? 'Siqilmoqda…' : 'Siqish'}
          </button>
        </div>
        {st && (
          <>
            <div className="list" style={{ marginBottom: 14 }}>
              <div className="kv"><span className="k">Toʻlovlar</span><span className="v mono">{fmtInt(st.tables.bills)}</span></div>
              <div className="kv"><span className="k">Topilgan ishlar</span><span className="v mono">{fmtInt(st.tables.foundCases)}</span></div>
              <div className="kv"><span className="k">Ish tafsilotlari</span><span className="v mono">{fmtInt(st.tables.details)}</span></div>
              <div className="kv"><span className="k">Urinilgan raqamlar</span><span className="v mono">{fmtInt(st.tables.tried)}</span></div>
              <div className="kv"><span className="k">Drayver</span><span className="v mono">{st.driver} · v{st.schemaVersion}</span></div>
              {st.legacyImport && (
                <div className="kv"><span className="k">Eski fayllardan olingan</span><span className="v mono">{fmtInt(st.legacyImport.bills)} toʻlov · {fmtInt(st.legacyImport.found)} ish · {fmtInt(st.legacyImport.details)} tafsilot</span></div>
              )}
            </div>
            {Object.keys(st.byCourt).length > 0 && (
              <div className="list" style={{ marginBottom: 14 }}>
                {Object.entries(st.byCourt).map(([c, v]) => (
                  <div className="kv" key={c}><span className="k">{COURT[c] ?? c}</span><span className="v mono">{fmtInt(v.found)} ish · {fmtInt(v.details)} tafsilot</span></div>
                ))}
              </div>
            )}
            {st.companies.length > 0 && (
              <div className="list">
                {st.companies.map((c) => (
                  <div className="kv" key={c.tin}>
                    <span className="k mono">{c.tin}</span>
                    <span className="v mono faint" style={{ fontSize: 12 }}>{fmtInt(c.bills)} toʻlov{c.loaded ? '' : ' (toʻliq emas)'} · {fmtInt(c.found)} ish</span>
                    <button className="btn btn-outline btn-sm" onClick={() => void forget(c.tin)} disabled={!!busy} aria-label="Kompaniya maʼlumotini oʻchirish">
                      <Trash2 />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
