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
import sharp from 'sharp'
import { docById } from './registry'

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

  // Optional per-company letterhead: swap the banner image the templates embed
  // at word/media/image1.png. Everything is normalised to PNG (sharp) so the
  // part name / content-type stay valid and Word renders it into the same box.
  if (letterheadPngBase64) {
    const png = await letterheadToPng(letterheadPngBase64)
    if (png && zip.file('word/media/image1.png')) {
      zip.file('word/media/image1.png', png)
    }
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

/** Decode a base64 image (data-URL or raw) and re-encode as a bounded PNG. */
async function letterheadToPng(b64: string): Promise<Buffer | null> {
  try {
    const raw = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64
    const input = Buffer.from(raw, 'base64')
    if (input.length === 0 || input.length > 12 * 1024 * 1024) return null
    return await sharp(input)
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
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
