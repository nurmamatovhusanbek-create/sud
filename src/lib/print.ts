/**
 * Client-side print → "Save as PDF", styled to match the app.
 *
 * printHtml(title, bodyHtml) opens a blank window, writes a self-contained
 * document with a scoped, app-themed print stylesheet, waits for paint, calls
 * print() and closes. No dependencies; works offline.
 *
 * The sheet adapts to the app's active theme (data-theme on <html>): a light
 * document in light mode, a dark document in dark mode. `print-color-adjust:
 * exact` keeps the brand colors and fills in the exported PDF.
 *
 * Callers build the body with these classes: .pr-head/.pr-eyebrow/.pr-title/
 * .pr-meta/.pr-badge, .pr-sec, .pr-kv (.k/.v), .pr-total, .pr-next
 * (.pr-next-date/.pr-next-meta), .pr-text, table.pr-table.
 */

interface Palette {
  bg: string; surface: string; inset: string
  t1: string; t2: string; t3: string
  border: string; borderSoft: string
  accent: string; accentText: string; accentSoft: string
  pos: string; neg: string
}

function palette(dark: boolean): Palette {
  return dark
    ? {
        bg: '#0f1326', surface: '#161b34', inset: '#1b2140',
        t1: '#edeef6', t2: '#aab3d8', t3: '#8b93b8',
        border: 'rgba(255,255,255,0.13)', borderSoft: 'rgba(255,255,255,0.08)',
        accent: '#6d84ec', accentText: '#ffffff', accentSoft: 'rgba(109,132,236,0.16)',
        pos: '#4ec08a', neg: '#e06a86',
      }
    : {
        bg: '#f4f5fd', surface: '#ffffff', inset: '#f6f7fd',
        t1: '#1f2547', t2: '#5c6489', t3: '#98a0c4',
        border: '#dadff0', borderSoft: '#e9ebf7',
        accent: '#1a2350', accentText: '#ffffff', accentSoft: '#eef1fd',
        pos: '#2f8f5b', neg: '#c04a68',
      }
}

function printCss(p: Palette): string {
  return `
  :root { --pbg:${p.bg}; --ps:${p.surface}; --pin:${p.inset}; --t1:${p.t1}; --t2:${p.t2}; --t3:${p.t3}; --pb:${p.border}; --pbs:${p.borderSoft}; --pa:${p.accent}; --pat:${p.accentText}; --pas:${p.accentSoft}; --pos:${p.pos}; --neg:${p.neg}; }
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { background: var(--pbg); }
  body { font-family: "Plus Jakarta Sans", -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-size: 12.5px; color: var(--t1); padding: 24px; }
  .pr-sheet { background: var(--ps); border: 1px solid var(--pb); border-radius: 14px; overflow: hidden; }

  /* masthead */
  .pr-brand { display: flex; align-items: center; gap: 10px; background: var(--pa); color: var(--pat); padding: 13px 22px; }
  .pr-logo { width: 26px; height: 26px; border-radius: 8px; background: rgba(255,255,255,.16); display: grid; place-items: center; font-weight: 800; font-size: 14px; }
  .pr-brand b { font-size: 14px; font-weight: 700; letter-spacing: -.01em; }
  .pr-brand .by { margin-left: auto; font-size: 10.5px; opacity: .8; letter-spacing: .04em; }

  .pr-inner { padding: 22px 24px 20px; }

  /* doc header */
  .pr-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding-bottom: 14px; margin-bottom: 6px; border-bottom: 1.5px solid var(--pb); }
  .pr-eyebrow { font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--t3); font-weight: 700; margin-bottom: 4px; }
  .pr-title { font-size: 21px; font-weight: 800; letter-spacing: -.02em; color: var(--t1); line-height: 1.15; }
  .pr-meta { text-align: right; font-size: 11px; color: var(--t2); white-space: nowrap; line-height: 1.5; }
  .pr-badge { display: inline-block; background: var(--pas); color: var(--pa); border: 1px solid var(--pb); border-radius: 999px; padding: 3px 11px; font-size: 11px; font-weight: 700; margin: 4px 4px 0 0; }

  /* section label */
  .pr-sec { display: flex; align-items: center; gap: 8px; margin: 20px 0 8px; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--pa); font-weight: 800; }
  .pr-sec::after { content: ""; flex: 1; height: 1px; background: var(--pbs); }

  /* key / value rows */
  .pr-kv { display: flex; justify-content: space-between; gap: 18px; padding: 8px 12px; border-radius: 8px; }
  .pr-kv:nth-child(even) { background: var(--pin); }
  .pr-kv .k { color: var(--t2); white-space: nowrap; font-weight: 500; }
  .pr-kv .v { text-align: right; font-weight: 600; color: var(--t1); }

  .pr-total { display: flex; justify-content: space-between; align-items: baseline; padding: 12px 14px; margin-top: 10px; border-radius: 10px; background: var(--pas); border: 1px solid var(--pb); font-weight: 800; }
  .pr-total .k { color: var(--pa); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .pr-total .v { font-size: 16px; color: var(--pa); }

  .pr-next { border: 1px solid var(--pb); border-left: 3px solid var(--pa); border-radius: 10px; padding: 12px 16px; margin-top: 4px; background: var(--pin); }
  .pr-next-date { font-size: 15px; font-weight: 800; color: var(--t1); }
  .pr-next-meta { font-size: 11.5px; color: var(--t2); margin-top: 3px; }
  .pr-text { padding: 6px 2px; font-size: 12.5px; line-height: 1.55; color: var(--t1); }

  /* tables */
  table.pr-table { width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 8px; border: 1px solid var(--pb); border-radius: 10px; overflow: hidden; }
  table.pr-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--pat); background: var(--pa); padding: 8px 10px; font-weight: 700; }
  table.pr-table td { border-top: 1px solid var(--pbs); padding: 8px 10px; vertical-align: top; color: var(--t1); }
  table.pr-table tbody tr:nth-child(even) td { background: var(--pin); }

  .pr-pos { color: var(--pos); font-weight: 700; }
  .pr-neg { color: var(--neg); font-weight: 700; }

  .pr-foot { display: flex; justify-content: space-between; gap: 12px; margin-top: 18px; padding: 12px 24px; font-size: 10px; color: var(--t3); border-top: 1px solid var(--pbs); }

  @page { size: A4; margin: 12mm 10mm; }
  @media print { body { padding: 0; } .pr-sheet { border-radius: 0; border: none; } }
`
}

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

/** Read the app's active theme from <html data-theme>. Defaults to light. */
function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.getAttribute('data-theme') === 'dark'
}

/** Build the full themed document — exported so a caller/test can render it. */
export function buildPrintDoc(title: string, bodyHtml: string, dark = isDarkTheme()): string {
  const p = palette(dark)
  return `<!doctype html><html lang="uz" data-theme="${dark ? 'dark' : 'light'}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${printCss(p)}</style></head><body>
<div class="pr-sheet">
  <div class="pr-brand"><span class="pr-logo">S</span><b>Sud tizimi</b><span class="by">by Nurmamatov</span></div>
  <div class="pr-inner">${bodyHtml}</div>
  <div class="pr-foot"><span>sud.uz maʼlumotlari asosida tayyorlangan</span><span>${stamp()}</span></div>
</div>
</body></html>`
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
  w.document.open()
  w.document.write(buildPrintDoc(title, bodyHtml))
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
