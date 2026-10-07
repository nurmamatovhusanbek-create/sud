/**
 * Server-only .docx filling: load a template, substitute every {{key}} in
 * word/document.xml with the (XML-escaped) form value, and return the bytes.
 * The substitution itself lives in fill.shared.ts (shared with the preview).
 *
 * The templates already collapse each value into a single {{key}} run
 * (scripts/doc-templates), so this is a plain string replace — no run-merge
 * gymnastics needed at request time. jszip is already a project dependency.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { docById } from './registry'
import { fillXml } from './fill.shared'
import { applyLetterhead } from './banner'

const TEMPLATE_DIR = path.join(process.cwd(), 'src', 'lib', 'documents', 'templates')

export interface GeneratedDoc {
  buffer: Buffer
  filename: string
}

export interface GenerateOpts {
  /** Uploaded per-company letterhead (base64 PNG) — replaces the banner. */
  letterhead?: string
  /** When no letterhead is given, blank the embedded banner (leave space) —
   *  used by categories that offer the uploader (visa/iio). Categories with no
   *  uploader (court petitions) omit it so an embedded letterhead is kept. */
  blankIfNone?: boolean
}

/** Raw bytes of a document's .docx template (also served to the live preview). */
export async function readTemplate(docId: string): Promise<Buffer> {
  const def = docById(docId)
  if (!def) throw new Error('Nomaʼlum hujjat turi')

  const file = path.join(TEMPLATE_DIR, def.file)
  // guard against path escapes even though docId is validated above
  if (!file.startsWith(TEMPLATE_DIR)) throw new Error('Nomaʼlum hujjat turi')
  return fs.readFile(file)
}

export async function generateDocx(
  docId: string,
  values: Record<string, string>,
  opts: GenerateOpts = {},
): Promise<GeneratedDoc> {
  const def = docById(docId)
  if (!def) throw new Error('Nomaʼlum hujjat turi')

  const raw = await readTemplate(docId)
  const zip = await JSZip.loadAsync(raw)
  const docXmlFile = zip.file('word/document.xml')
  if (!docXmlFile) throw new Error('Shablon buzilgan')

  const xml = await docXmlFile.async('string')
  zip.file('word/document.xml', fillXml(xml, values))

  // uploaded PNG → used, fitted to the page width; none + blank → transparent; none → the embedded banner stays
  await applyLetterhead(zip, opts.letterhead, !!opts.blankIfNone)

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  const person = slug(values.full_name || values.applicant_person || values.rep_name || values.case_number || 'hujjat')
  const filename = `${def.slug}-${person}-${stamp()}.docx`
  return { buffer, filename }
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
