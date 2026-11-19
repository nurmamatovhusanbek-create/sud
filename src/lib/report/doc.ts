/**
 * Company report — the full HTML document (header/footer repeat on every page).
 */

import { formatDmy } from '@/core/dates'
import { escapeHtml as h } from '@/lib/print'
import type { ReportModel } from './model'
import { renderReportBody, renderReportFooter, renderReportRunHead, renderReportWatermark, reportCss, reportTheme } from './render'
import { renderInkDoc } from './render-ink'
import type { Look } from '@/lib/look'

export interface ReportDocOpts {
  dark?: boolean
  /** @font-face rules copied from the app so the PDF uses the app's own typefaces */
  fontFaceCss?: string
  /** the family name(s) those rules define, tried before the system stack */
  fontFamily?: string
  fontMono?: string
  /** the app's own sans (IBM Plex Sans), tried first in the «premium» edition */
  fontPlexSans?: string
  /** which edition: «premium» = ink / near-white (the app's default look), «navy» = the navy Dossier. Default «navy» (the original). */
  look?: Look
}

const SYSTEM_STACK = '"Plus Jakarta Sans", -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
const PREMIUM_STACK = '"IBM Plex Sans", "Plus Jakarta Sans", -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
const MONO_STACK = '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace'

/**
 * A complete, self-contained document. The <title> is what browsers propose as the
 * PDF file name, so it carries the STIR and the date.
 *
 * One table row holds the two columns (navy rail | analysis); both fragment across
 * pages on their own. The thead reserves the top margin; the rail colour, the logo
 * watermark and the pinned footer are fixed (so they repeat on every page), and the tfoot reserves the footer's room.
 */
export function buildReportDoc(m: ReportModel, opts: ReportDocOpts = {}): string {
  const dark = !!opts.dark
  const ink = opts.look === 'premium'
  const title = `Kompaniya hisoboti ${m.stir} ${formatDmy(m.generatedAt)}`
  const mono = opts.fontMono ? `${opts.fontMono}, ${MONO_STACK}` : MONO_STACK
  if (ink) {
    // premium: IBM Plex Sans first, Plus Jakarta Sans for what Plex lacks (ʻ ʼ)
    const sans = [opts.fontPlexSans, opts.fontFamily].filter(Boolean).join(', ')
    return renderInkDoc(m, { dark, title, stack: sans ? `${sans}, ${PREMIUM_STACK}` : PREMIUM_STACK, mono, fontFaceCss: opts.fontFaceCss })
  }
  const t = reportTheme(dark)
  const stack = opts.fontFamily ? `${opts.fontFamily}, ${SYSTEM_STACK}` : SYSTEM_STACK
  const body = renderReportBody(m, t)
  const foot = renderReportFooter(m)
  return `<!doctype html><html lang="uz" data-theme="${dark ? 'dark' : 'light'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${h(title)}</title><style>${opts.fontFaceCss ?? ''}${reportCss(t, stack, mono)}</style></head><body>
<div class="rp-sheet">
<div class="rp-bg"></div>
${renderReportWatermark(t)}
${renderReportRunHead(m)}
<div class="rp-pin rp-pin-l">${foot.rail}</div><div class="rp-pin rp-pin-r">${foot.main}</div>
<table class="rp">
<colgroup><col class="l"><col></colgroup>
<thead><tr><td class="l"></td><td class="r"></td></tr></thead>
<tbody><tr><td class="l rp-rail">${body.rail}</td><td class="r rp-main">${body.main}</td></tr></tbody>
<tfoot><tr><td class="l"></td><td class="r"></td></tr></tfoot>
</table>
</div>
</body></html>`
}
