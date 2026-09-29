/**
 * Company report — the full HTML document (header/footer repeat on every page).
 */

import { formatDmy } from '@/core/dates'
import { escapeHtml as h } from '@/lib/print'
import type { ReportModel } from './model'
import { renderReportBody, renderReportFooter, renderReportHeader, reportCss, reportTheme } from './render'

export interface ReportDocOpts {
  dark?: boolean
  /** @font-face rules copied from the app so the PDF uses the app's own typefaces */
  fontFaceCss?: string
  /** the family name(s) those rules define, tried before the system stack */
  fontFamily?: string
  fontMono?: string
}

const SYSTEM_STACK = '"Plus Jakarta Sans", -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
const MONO_STACK = '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace'

/**
 * A complete, self-contained document. The <title> is what browsers propose as the
 * PDF file name, so it carries the STIR and the date.
 *
 * The header and footer live in a table's thead/tfoot: that is the one construct
 * every browser repeats on each printed page.
 */
export function buildReportDoc(m: ReportModel, opts: ReportDocOpts = {}): string {
  const dark = !!opts.dark
  const t = reportTheme(dark)
  const stack = opts.fontFamily ? `${opts.fontFamily}, ${SYSTEM_STACK}` : SYSTEM_STACK
  const mono = opts.fontMono ? `${opts.fontMono}, ${MONO_STACK}` : MONO_STACK
  const title = `Kompaniya hisoboti ${m.stir} ${formatDmy(m.generatedAt)}`
  return `<!doctype html><html lang="uz" data-theme="${dark ? 'dark' : 'light'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${h(title)}</title><style>${opts.fontFaceCss ?? ''}${reportCss(t, stack, mono)}</style></head><body>
<table class="rp">
<thead><tr><td>${renderReportHeader(m)}</td></tr></thead>
<tbody><tr><td>${renderReportBody(m, t)}</td></tr></tbody>
<tfoot><tr><td>${renderReportFooter()}</td></tr></tfoot>
</table>
</body></html>`
}
