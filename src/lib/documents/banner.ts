/**
 * Letterhead banner swap, shared by the server download (fill.server.ts, pretenzia/fill.server.ts) and the live
 * preview (doc-preview.tsx) so both always agree.
 *
 * Every banner-carrying template has the same construction (scripts/doc-templates/banner.mjs): a first-page header
 * with one inline picture as wide as the page, so it touches both page edges. Swapping in a letterhead therefore
 * only has to (1) replace the PNG and (2) give the picture the new PNG's own proportions: the width stays the page's
 * width, the height follows the image, so nothing is ever stretched.
 */
import type JSZip from 'jszip'
import { BLANK_PNG_B64 } from './fill.shared'

export const BANNER_MEDIA = 'word/media/image1.png'
export const BANNER_PART = 'word/header1.xml'
const MAX_BYTES = 12 * 1024 * 1024
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** base64 (raw or data-URL) → bytes; null when absent, too big, or not a PNG. */
export function decodePng(b64?: string): Uint8Array | null {
  if (!b64) return null
  try {
    const raw = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64
    const bin = atob(raw)
    if (bin.length < 24 || bin.length > MAX_BYTES) return null
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return PNG_MAGIC.every((b, i) => out[i] === b) ? out : null
  } catch {
    return null
  }
}

/** Pixel size from the PNG header (IHDR). */
export function pngSize(png: Uint8Array): { w: number; h: number } | null {
  if (png.length < 24) return null
  const u32 = (o: number) => ((png[o] << 24) | (png[o + 1] << 16) | (png[o + 2] << 8) | png[o + 3]) >>> 0
  const w = u32(16)
  const h = u32(20)
  return w > 0 && h > 0 ? { w, h } : null
}

/** Make the banner picture as tall as `size`'s proportions need at its current width; drop any crop. */
export function fitBannerXml(xml: string, size: { w: number; h: number }): string {
  const cx = Number(/<wp:extent\b[^>]*\bcx="(\d+)"/.exec(xml)?.[1])
  if (!cx) return xml
  const cy = Math.round((cx * size.h) / size.w)
  return xml
    .replace(/(<wp:extent\b[^>]*\bcy=")\d+(")/, `$1${cy}$2`)
    .replace(/(<a:ext\b[^>]*\bcy=")\d+(")/, `$1${cy}$2`)
    .replace(/<a:srcRect\b[^>]*\/>/g, '')
}

/**
 * Letterhead swap (only when the template embeds a banner):
 *  - uploaded PNG   → use it, fitted to the page width
 *  - none + blank   → transparent PNG (keeps the template's banner space, drops the branding)
 *  - none, no blank → leave the embedded banner untouched
 */
export async function applyLetterhead(zip: JSZip, letterhead: string | undefined, blankIfNone: boolean): Promise<void> {
  if (!zip.file(BANNER_MEDIA)) return
  const uploaded = decodePng(letterhead)
  const png = uploaded ?? (blankIfNone ? decodePng(BLANK_PNG_B64) : null)
  if (!png) return
  zip.file(BANNER_MEDIA, png)
  const size = uploaded && pngSize(uploaded)
  const part = zip.file(BANNER_PART)
  if (size && part) zip.file(BANNER_PART, fitBannerXml(await part.async('string'), size))
}
