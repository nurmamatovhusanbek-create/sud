/**
 * v204 (P-C): client-side print — replaces the fake "PDF yuklab olindi"
 * toast stubs with a real print dialog (browser "Save as PDF" included).
 *
 * printHtml(title, bodyHtml) opens a blank window, writes a self-contained
 * document with a scoped print stylesheet, waits for paint, calls print()
 * and closes. No dependencies; works offline; Monochrome-Signal friendly
 * (the sheet is pure black-on-white regardless of app theme).
 */

const PRINT_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; font-size: 12.5px; color: #111; padding: 28px 32px; }
  .pr-head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; gap: 16px; }
  .pr-eyebrow { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #555; margin-bottom: 3px; }
  .pr-title { font-size: 19px; font-weight: 700; }
  .pr-meta { text-align: right; font-size: 11px; color: #444; white-space: nowrap; }
  .pr-badge { display: inline-block; border: 1px solid #111; border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: 600; }
  .pr-sec { margin: 16px 0 6px; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #555; font-weight: 700; }
  .pr-kv { display: flex; justify-content: space-between; gap: 18px; padding: 5px 0; border-bottom: 1px dotted #bbb; }
  .pr-kv .k { color: #555; white-space: nowrap; }
  .pr-kv .v { text-align: right; font-weight: 500; }
  .pr-total { display: flex; justify-content: space-between; padding: 9px 0 0; margin-top: 8px; border-top: 2px solid #111; font-weight: 700; font-size: 14px; }
  .pr-next { border: 1.5px solid #111; border-radius: 6px; padding: 10px 14px; margin-top: 4px; }
  .pr-next-date { font-size: 15px; font-weight: 700; }
  .pr-next-meta { font-size: 11.5px; color: #444; margin-top: 3px; }
  .pr-text { padding: 6px 0; font-size: 12.5px; line-height: 1.5; }
  table.pr-table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.pr-table th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1.5px solid #111; padding: 5px 7px; background: #f2f2f2; }
  table.pr-table td { border-bottom: 1px solid #ddd; padding: 5px 7px; vertical-align: top; }
  table.pr-table tr:last-child td { border-bottom: none; }
  .pr-foot { margin-top: 22px; font-size: 10px; color: #777; display: flex; justify-content: space-between; border-top: 1px solid #ccc; padding-top: 8px; }
  @page { size: A4; margin: 14mm 12mm; }
  @media print { body { padding: 0; } }
`

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Today stamp for the sheet footer, e.g. 17.09.2026 08:45. */
function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * Open a print window with `bodyHtml` under `title`. Throws when the popup
 * is blocked so the caller can surface a toast instead of failing silently.
 */
export function printHtml(title: string, bodyHtml: string): void {
  if (typeof window === 'undefined') throw new Error('printHtml — faqat brauzerda')
  const w = window.open('', '_blank', 'width=920,height=1000')
  if (!w) {
    throw new Error('Brauzer chop etish oynasini blokladi — pop-up ruxsatini bering')
  }
  const doc = `<!doctype html><html lang="uz"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head><body>${bodyHtml}
<div class="pr-foot"><span>Sud tizimi · by Nurmamatov · sud.uz maʼlumotlari asosida</span><span>${stamp()}</span></div>
</body></html>`
  w.document.open()
  w.document.write(doc)
  w.document.close()

  const doPrint = () => {
    try {
      w.focus()
      w.print()
    } finally {
      // Chrome/Firefox block inside print() until the dialog is handled;
      // Safari returns early — give the sheet a beat before closing.
      setTimeout(() => {
        try { w.close() } catch { /* already closed */ }
      }, 400)
    }
  }
  if (w.document.readyState === 'complete') setTimeout(doPrint, 150)
  else w.addEventListener('load', () => setTimeout(doPrint, 150), { once: true })
}
