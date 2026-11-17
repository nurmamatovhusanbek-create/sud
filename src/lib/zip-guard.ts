import type JSZip from 'jszip'

/**
 * A .docx / .xlsx is a zip, and a zip can lie: the sizes in its headers are written by whoever made the file, so a 600 KB
 * archive can declare «200 bytes» and still inflate to gigabytes (JSZip only notices AFTER inflating everything, which is too
 * late for the memory). `assertZipBounded` inflates every entry for real and counts the bytes that actually come out, and
 * stops the moment the budget is spent. Works in Node and in the browser (JSZip's own stream, no Node API).
 */

export class ZipTooLargeError extends Error {
  constructor(message = 'Fayl ochilganda juda katta') {
    super(message)
    this.name = 'ZipTooLargeError'
  }
}

interface Streamable {
  internalStream(type: 'uint8array'): {
    on(ev: 'data', cb: (chunk: Uint8Array) => void): unknown
    on(ev: 'error', cb: (e: Error) => void): unknown
    on(ev: 'end', cb: () => void): unknown
    pause(): unknown
    resume(): unknown
  }
}

export async function assertZipBounded(zip: JSZip, opts: { maxEntries: number; maxTotal: number }): Promise<void> {
  const files = Object.values(zip.files).filter((f) => !f.dir)
  if (files.length > opts.maxEntries) throw new ZipTooLargeError('Faylda juda koʻp boʻlak bor')
  let total = 0
  for (const f of files) {
    await new Promise<void>((resolve, reject) => {
      const s = (f as unknown as Streamable).internalStream('uint8array')
      let done = false
      const stop = (e?: Error) => {
        if (done) return
        done = true
        try { s.pause() } catch { /* already finished */ }
        if (e) reject(e)
        else resolve()
      }
      s.on('data', (chunk) => {
        total += chunk.length
        if (total > opts.maxTotal) stop(new ZipTooLargeError())
      })
      s.on('error', (e) => stop(e instanceof Error ? e : new Error(String(e))))
      s.on('end', () => stop())
      s.resume()
    })
  }
}
