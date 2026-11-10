import 'server-only'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import JSZip from 'jszip'
import { MAX_CUSTOM_FIELDS, isCustomId, metaFor, registerCustomDocs, scanTemplate, slugify, type CustomMeta } from './custom'

/**
 * The operator's own .docx templates, on THIS machine: `~/.sud-tizimi/templates/<id>.docx` (+ `<id>.json` with the
 * title and fields). Outside the project and never in git, like the orders cache. An uploaded file is untrusted:
 * size, entry count and unpacked size are capped, a macro-enabled file is refused, only a generated id ever becomes a
 * file name, and only `word/document.xml` is rewritten (markers put into one run each).
 */

export const customDir = (): string => process.env.DOC_TEMPLATES_DIR || path.join(os.homedir(), '.sud-tizimi', 'templates')

const ID_RE = /^custom_[a-z0-9-]{1,40}_[a-z0-9]{4}$/
const MAX_UPLOAD = 5 * 1024 * 1024
const MAX_ENTRIES = 1000
const MAX_UNPACKED = 40 * 1024 * 1024

export class TemplateError extends Error {}

const fileOf = (id: string, ext: 'docx' | 'json'): string => {
  if (!ID_RE.test(id)) throw new TemplateError('Shablon topilmadi')
  return path.join(customDir(), `${id}.${ext}`)
}

/** unpacked size JSZip recorded for an entry (its internal field; unknown → 0) */
const unpacked = (zip: JSZip, name: string): number => (zip.files[name] as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0

export interface SavedTemplate {
  meta: CustomMeta
  /** markers that could not be read as a field (left in the text as written) */
  invalid: string[]
}

export async function saveCustom(buffer: Buffer, title: string): Promise<SavedTemplate> {
  if (!buffer.length) throw new TemplateError('Fayl boʻsh')
  if (buffer.length > MAX_UPLOAD) throw new TemplateError('Fayl juda katta (eng koʻpi 5 MB)')
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new TemplateError('Bu .docx fayl emas (yoki buzilgan)')
  }
  const names = Object.keys(zip.files)
  if (names.length > MAX_ENTRIES) throw new TemplateError('Faylda juda koʻp boʻlak bor')
  if (names.reduce((n, k) => n + unpacked(zip, k), 0) > MAX_UNPACKED) throw new TemplateError('Fayl ochilganda juda katta')
  if (!zip.file('word/document.xml') || !zip.file('[Content_Types].xml')) throw new TemplateError('Bu Word (.docx) hujjati emas')
  const types = await zip.file('[Content_Types].xml')!.async('string')
  if (names.some((n) => /vbaProject\.bin$/i.test(n)) || /macroEnabled/i.test(types)) throw new TemplateError('Makroli fayl qabul qilinmaydi: «Word hujjati (.docx)» sifatida saqlang')

  const scan = scanTemplate(await zip.file('word/document.xml')!.async('string'))
  if (!scan.keys.length) throw new TemplateError('Shablonda {{maydon}} belgilari topilmadi. Matnga {{korxona}} kabi belgi yozing')
  if (scan.keys.length > MAX_CUSTOM_FIELDS) throw new TemplateError(`Maydonlar juda koʻp (eng koʻpi ${MAX_CUSTOM_FIELDS})`)

  zip.file('word/document.xml', scan.xml)
  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  const id = `custom_${slugify(title)}_${crypto.randomBytes(2).toString('hex')}`
  const meta = metaFor(title, scan.keys, id)

  await fs.mkdir(customDir(), { recursive: true, mode: 0o700 })
  const tmp = `${fileOf(id, 'docx')}.${process.pid}.tmp`
  await fs.writeFile(tmp, out, { mode: 0o600 })
  await fs.rename(tmp, fileOf(id, 'docx'))
  await fs.writeFile(fileOf(id, 'json'), JSON.stringify(meta, null, 2), { mode: 0o600 })
  await ensureCustomRegistered()
  return { meta, invalid: scan.invalid }
}

const isMeta = (m: unknown): m is CustomMeta => {
  const o = m as Partial<CustomMeta> | null
  return !!o && typeof o.id === 'string' && ID_RE.test(o.id) && typeof o.title === 'string' && Array.isArray(o.fields) && o.fields.every((f) => typeof f?.key === 'string' && typeof f?.label === 'string')
}

export async function listCustom(): Promise<CustomMeta[]> {
  let names: string[]
  try {
    names = await fs.readdir(customDir())
  } catch {
    return []
  }
  const out: CustomMeta[] = []
  for (const n of names.filter((x) => x.endsWith('.json'))) {
    try {
      const m = JSON.parse(await fs.readFile(path.join(customDir(), n), 'utf8')) as unknown
      if (isMeta(m)) out.push(m)
    } catch {
      /* a damaged file is skipped */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteCustom(id: string): Promise<void> {
  await fs.rm(fileOf(id, 'docx'), { force: true })
  await fs.rm(fileOf(id, 'json'), { force: true })
  await ensureCustomRegistered()
}

export async function readCustomTemplate(id: string): Promise<Buffer> {
  try {
    return await fs.readFile(fileOf(id, 'docx'))
  } catch {
    throw new TemplateError('Shablon topilmadi')
  }
}

/** make the registry (this process's) know the saved templates; cheap: a few small files */
export async function ensureCustomRegistered(): Promise<void> {
  registerCustomDocs(await listCustom())
}

export { isCustomId }
