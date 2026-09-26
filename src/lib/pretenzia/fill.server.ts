/**
 * Server-only fill for the Претензия template. Loads pretenzia.docx once,
 * fills the {{key}} runs for each selected contract, and returns either a
 * single .docx (one contract) or a .zip bundle (several). jszip only.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { renderClaimValues, type ClaimConstants, type ClaimContractInput } from './render'

const TEMPLATE_DIR = path.join(process.cwd(), 'src', 'lib', 'documents', 'templates')
const TEMPLATE_FILE = { ru: 'pretenzia.docx', uz: 'talabnoma-uz.docx' } as const
const NAME_PREFIX = { ru: 'Pretenziya', uz: 'Talabnoma' } as const

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fillXml(xml: string, values: Record<string, string>): string {
  return xml.replace(/\{\{([a-z_]+)\}\}/g, (_m, key: string) => {
    const v = values[key]
    return v ? escapeXml(v) : ''
  })
}

/** ascii-safe slug for a download filename. */
function slug(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[’‘ʼ`]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'pretenziya'
  )
}

function stamp(claimDate: Date): string {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${claimDate.getFullYear()}-${p(claimDate.getMonth() + 1)}-${p(claimDate.getDate())}`
}

export interface GeneratedFile {
  buffer: Buffer
  filename: string
  /** true when several claims were bundled into a .zip. */
  zipped: boolean
}

/** Fill one contract's .docx and return its bytes + a per-contract filename. */
async function fillOne(templateXml: string, base: JSZip, c: ClaimContractInput, k: ClaimConstants, prefix: string): Promise<{ buffer: Buffer; name: string }> {
  const values = renderClaimValues(c, k)
  base.file('word/document.xml', fillXml(templateXml, values))
  const buffer = await base.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  return { buffer, name: `${prefix}-${slug(c.no)}-${stamp(k.claimDate)}.docx` }
}

export async function generatePretenzia(
  contracts: ClaimContractInput[],
  constants: ClaimConstants,
): Promise<GeneratedFile> {
  if (contracts.length === 0) throw new Error('Shartnoma tanlanmadi')

  const lang = constants.lang ?? 'ru'
  const prefix = NAME_PREFIX[lang]
  const raw = await fs.readFile(path.join(TEMPLATE_DIR, TEMPLATE_FILE[lang]))
  const zip = await JSZip.loadAsync(raw)
  const docXml = zip.file('word/document.xml')
  if (!docXml) throw new Error('Shablon buzilgan')
  const templateXml = await docXml.async('string')

  const files: { buffer: Buffer; name: string }[] = []
  for (const c of contracts) {
    // reload a clean zip per document so each keeps the full template payload
    const perZip = await JSZip.loadAsync(raw)
    files.push(await fillOne(templateXml, perZip, c, constants, prefix))
  }

  if (files.length === 1) {
    return { buffer: files[0].buffer, filename: files[0].name, zipped: false }
  }

  const bundle = new JSZip()
  for (const f of files) bundle.file(f.name, f.buffer)
  const buffer = await bundle.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  return { buffer, filename: `${prefix}-${files.length}-dona-${stamp(constants.claimDate)}.zip`, zipped: true }
}
