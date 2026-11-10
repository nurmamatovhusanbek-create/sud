import JSZip from 'jszip'
import { fetchDocTemplate } from '@/lib/api-client'
import { fillXml } from './fill.shared'
import { applyLetterhead } from './banner'
import { withDerived } from './derive'

/**
 * A finished document as printable HTML (for «PDF»: the browser's own print → «Save as PDF»).
 *
 * It is the SAME fill the .docx download does (`fillXml`, `withDerived`, the letterhead swap), rendered by docx-preview
 * into an off-screen element and handed back as markup, so the PDF reads exactly like the Word file: empty spots stay
 * empty (no preview highlights or example text), and no second layout engine has to agree with Word.
 */

/** Wrap the rendered pages in a print sheet: A4, no margins of its own (the pages carry theirs), one page per page. */
export function printSheet(title: string, pagesHtml: string): string {
  const esc = title.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8"><title>${esc}</title><style>
@page { size: A4; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.docx-wrapper { background: #fff !important; padding: 0 !important; display: block !important; }
.docx-wrapper > section.docx { box-shadow: none !important; margin: 0 auto !important; break-after: page; page-break-after: always; }
.docx-wrapper > section.docx:last-child { break-after: auto; page-break-after: auto; }
@media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>${pagesHtml}</body></html>`
}

export async function renderPrintHtml(docId: string, values: Record<string, string>, opts: { letterhead?: string; blank?: boolean } = {}): Promise<string> {
  const buf = await fetchDocTemplate(docId)
  const zip = await JSZip.loadAsync(buf)
  const f = zip.file('word/document.xml')
  if (!f) throw new Error('Shablon buzilgan')
  zip.file('word/document.xml', fillXml(await f.async('string'), withDerived(values)))
  if (zip.file('word/media/image1.png')) await applyLetterhead(zip, opts.letterhead, !!opts.blank)
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })

  let renderAsync: typeof import('docx-preview').renderAsync
  try {
    renderAsync = (await import('docx-preview')).renderAsync
  } catch {
    throw new Error('«docx-preview» kutubxonasi oʻrnatilmagan. «bun install» ishga tushiring.')
  }
  const stage = document.createElement('div')
  stage.style.cssText = 'position:fixed;left:-100000px;top:0;width:1200px;visibility:hidden'
  document.body.appendChild(stage)
  try {
    await renderAsync(bytes, stage, stage, {
      className: 'docx', inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true, useBase64URL: true,
      renderHeaders: true, renderFooters: true, renderFootnotes: false, renderEndnotes: false, renderComments: false, renderChanges: false,
    })
    return stage.innerHTML
  } finally {
    stage.remove()
  }
}
