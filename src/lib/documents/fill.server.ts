/**
 * Server-only .docx filling: load a template, substitute every {{key}} in
 * word/document.xml with the (XML-escaped) form value, and return the bytes.
 *
 * The templates already collapse each value into a single {{key}} run
 * (scripts/doc-templates), so this is a plain string replace — no run-merge
 * gymnastics needed at request time. jszip is already a project dependency.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { docById } from './registry'

// A 1×1 fully transparent PNG. When no letterhead is supplied we swap the
// template's embedded banner for this — the drawing box (and thus the vertical
// space) is preserved, but no company branding is forced onto the document.
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const TEMPLATE_DIR = path.join(process.cwd(), 'src', 'lib', 'documents', 'templates')

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // keep quotes literal in text nodes (they are valid), but be safe in attrs
    .replace(/"/g, '&quot;')
}

/**
 * Replace {{key}} placeholders. Unknown/blank keys collapse to '' so no stray
 * `{{…}}` ever survives into the delivered document.
 */
function fillXml(xml: string, values: Record<string, string>): string {
  return xml.replace(/\{\{([a-z_]+)\}\}/g, (_m, key: string) => {
    const v = values[key]
    return v ? escapeXml(v) : ''
  })
}

export interface GeneratedDoc {
  buffer: Buffer
  filename: string
}

export async function generateDocx(
  docId: string,
  values: Record<string, string>,
  letterheadPngBase64?: string,
): Promise<GeneratedDoc> {
  const def = docById(docId)
  if (!def) throw new Error('Nomaʼlum hujjat turi')

  const file = path.join(TEMPLATE_DIR, def.file)
  // guard against path escapes even though docId is validated above
  if (!file.startsWith(TEMPLATE_DIR)) throw new Error('Nomaʼlum hujjat turi')

  const raw = await fs.readFile(file)
  const zip = await JSZip.loadAsync(raw)
  const docXmlFile = zip.file('word/document.xml')
  if (!docXmlFile) throw new Error('Shablon buzilgan')

  const xml = await docXmlFile.async('string')
  zip.file('word/document.xml', fillXml(xml, values))

  // Letterhead: the templates embed a banner at word/media/image1.png. We
  // always replace it — with the uploaded PNG when given (the client sends a
  // canvas-encoded PNG so it is already valid), otherwise with a blank
  // transparent PNG so the space is kept but no branding is imposed.
  if (zip.file('word/media/image1.png')) {
    zip.file('word/media/image1.png', decodePng(letterheadPngBase64) ?? BLANK_PNG)
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  const person = slug(values.full_name || 'hujjat')
  const filename = `${def.slug}-${person}-${stamp()}.docx`
  return { buffer, filename }
}

/** Decode a base64 PNG (data-URL or raw). Returns null if absent or not a PNG. */
function decodePng(b64?: string): Buffer | null {
  if (!b64) return null
  try {
    const raw = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64
    const buf = Buffer.from(raw, 'base64')
    if (buf.length < 8 || buf.length > 12 * 1024 * 1024) return null
    if (!buf.subarray(0, 8).equals(PNG_MAGIC)) return null
    return buf
  } catch {
    return null
  }
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10)
}

/** ascii-safe slug for the download filename (content-disposition filename=""). */
function slug(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[’‘ʼ`]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'hujjat'
  )
}
