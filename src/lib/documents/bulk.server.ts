import JSZip from 'jszip'
import { generateDocx, type GenerateOpts } from './fill.server'
import { MAX_BULK_ROWS } from './bulk'

/** One .docx per row, in one zip. Rows are numbered (01-, 02-…) so two people with the same name never overwrite each other. */
export async function generateBulkZip(docId: string, rows: Record<string, string>[], opts: GenerateOpts = {}): Promise<{ buffer: Buffer; filename: string }> {
  if (!rows.length) throw new Error('Qatorlar yoʻq')
  if (rows.length > MAX_BULK_ROWS) throw new Error(`Bir martada eng koʻpi bilan ${MAX_BULK_ROWS} ta qator`)
  const zip = new JSZip()
  for (let i = 0; i < rows.length; i++) {
    const d = await generateDocx(docId, rows[i], opts)
    zip.file(`${String(i + 1).padStart(2, '0')}-${d.filename}`, d.buffer)
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  return { buffer, filename: `${docId}-${rows.length}-ta-${new Date().toISOString().slice(0, 10)}.zip` }
}
