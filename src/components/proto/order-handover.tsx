'use client'

/**
 * The hand-over for an order public.sud.uz would not give automatically (it wants a person to pass its captcha):
 * open the site, save the PDF there, pick it here. Shared by the case drawer and the Qarorlar search.
 */

import { ExternalLink, Loader2, RefreshCw, Upload } from 'lucide-react'

export function OrderHandover({ importing, busy, onFile, onRetry }: { importing: boolean; busy: boolean; onFile: (f: File | undefined) => void; onRetry: () => void }) {
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
        <button className="btn btn-outline btn-sm" disabled={busy} onClick={onRetry} title="Avtomatik yuklashni yana bir bor sinab koʻrish">
          <RefreshCw />
          <span>Avtomatik qayta urinish</span>
        </button>
      </div>
    </div>
  )
}
