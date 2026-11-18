'use client'

/**
 * The hand-over for an order public.sud.uz would not give automatically (it wants a person to pass its captcha):
 * open the site, save the PDF there, pick it here. Shared by the case drawer and the Qarorlar search.
 */

import { ExternalLink, FileArchive, Loader2, RefreshCw, Upload } from 'lucide-react'

export function OrderHandover({ importing, busy, onFile, onHar, onRetry }: { importing: boolean; busy: boolean; onFile: (f: File | undefined) => void; onHar?: (f: File | undefined) => void; onRetry: () => void }) {
  return (
    <div className="dw-orders-empty" style={{ display: 'grid', gap: 8 }}>
      <span>
        public.sud.uz endi qarorni faqat odam tasdiqlagandan keyin beradi. Qarorni shu saytda oʻzingiz ochib, PDF ni saqlang va shu yerga tanlang — u bir marta saqlanadi.
      </span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <a className="btn btn-outline btn-sm" href="https://public.sud.uz/" target="_blank" rel="noopener noreferrer">
          <ExternalLink />
          <span>public.sud.uz ni ochish</span>
        </a>
        <label className="btn btn-outline btn-sm" style={{ cursor: importing ? 'wait' : 'pointer' }}>
          {importing ? <Loader2 className="spin" /> : <Upload />}
          <span>PDF ni tanlash</span>
          <input type="file" accept="application/pdf,.pdf" hidden disabled={importing} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        {onHar && <HarPicker importing={importing} onHar={onHar} />}
        <button className="btn btn-outline btn-sm" disabled={busy} onClick={onRetry} title="Avtomatik yuklashni yana bir bor sinab koʻrish">
          <RefreshCw />
          <span>Avtomatik qayta urinish</span>
        </button>
      </div>
    </div>
  )
}

/** «HAR dan yuklash»: one file saved from the browser holds the order PDF (no download button needed). Used here and on the Qarorlar page. */
export function HarPicker({ importing, onHar }: { importing: boolean; onHar: (f: File | undefined) => void }) {
  return (
    <label className="btn btn-outline btn-sm" style={{ cursor: importing ? 'wait' : 'pointer' }} title="Brauzerdan saqlangan HAR fayldan qarorni oʻzi topib saqlaydi">
      {importing ? <Loader2 className="spin" /> : <FileArchive />}
      <span>HAR fayldan yuklash</span>
      <input type="file" accept=".har,application/json" hidden disabled={importing} onChange={(e) => { onHar(e.target.files?.[0]); e.target.value = '' }} />
    </label>
  )
}

/** The four steps, short enough to follow without knowing DevTools. */
export function HarHowTo() {
  return (
    <details className="faint" style={{ fontSize: 12.5 }}>
      <summary style={{ cursor: 'pointer' }}>Qaror faqat oynada koʻrinsa: qanday saqlayman?</summary>
      <ol style={{ margin: '6px 0 0', paddingLeft: 18, display: 'grid', gap: 3 }}>
        <li>public.sud.uz da <b>F12</b> bosing va yuqoridagi <b>Network</b> yorligʻini oching.</li>
        <li>Qarorni oching va oyna toʻliq yuklanguncha kuting.</li>
        <li>Network roʻyxatida sichqonchaning oʻng tugmasini bosing va <b>Save all as HAR with content</b> ni tanlang. Fayl bitta boʻladi.</li>
        <li>Shu faylni yuqoridagi <b>HAR fayldan yuklash</b> orqali tanlang. Qaror oʻzi topilib saqlanadi. Keyin HAR faylni oʻchirib tashlang: unda cookie va tokenlar bor.</li>
      </ol>
    </details>
  )
}
