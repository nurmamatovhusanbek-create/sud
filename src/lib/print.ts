'use client'

/**
 * v204 (P-C): Real print/PDF support — replaces the fake
 * `toast.success('… yuklab olindi')` stubs the rewrite shipped with.
 *
 * Opens a self-contained print sheet (scoped styles, no app CSS, no
 * dependencies) and triggers the browser print dialog — the user picks
 * "Save as PDF" from there. Returns false when the popup was blocked so the
 * caller can toast a hint instead of silently doing nothing.
 */

export function printHtml(title: string, bodyHtml: string): boolean {
  const w = window.open('', '_blank', 'width=820,height=1000')
  if (!w) return false

  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>
      *{box-sizing:border-box}
      body{font:13px/1.5 -apple-system,'Segoe UI',Roboto,sans-serif;color:#111;margin:32px}
      h1{font-size:18px;margin:0 0 4px}
      h2{font-size:14px;margin:18px 0 6px}
      .muted{color:#666;font-size:12px}
      table{width:100%;border-collapse:collapse;margin-top:12px}
      th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e5e5e5;font-size:12px;vertical-align:top}
      th{background:#0a0a0a;color:#fff;font-weight:600}
      .kv{display:flex;justify-content:space-between;gap:24px;padding:4px 0;border-bottom:1px dashed #ddd}
      .kv span:first-child{color:#555}
      .kv span:last-child{font-weight:500;text-align:right}
      .total{margin-top:10px;padding-top:8px;border-top:2px solid #111;font-weight:700;display:flex;justify-content:space-between}
      @media print{@page{margin:14mm}}
    </style></head><body>${bodyHtml}</body></html>`,
  )
  w.document.close()
  w.focus()
  // give the new document a tick to lay out before printing
  setTimeout(() => {
    w.print()
  }, 250)
  return true
}

/** Small HTML-escaper for building print bodies from scraped strings. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
