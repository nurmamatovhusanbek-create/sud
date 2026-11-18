import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Next buffers a request body for the proxy and, by default, cuts it at 10 MB WITHOUT an error («Request body exceeded 10MB …
 * Only the first 10MB will be available»). The order-import routes then stored the first 10 MB of a 25 MB PDF as if it were the
 * whole file (pentest, Nov 2026). The cap in next.config.ts must stay above every route's own limit.
 */
const bytes = (s: string): number => {
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(s.trim())
  if (!m) throw new Error(`cannot read size «${s}»`)
  const mul = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[(m[2] ?? 'b').toLowerCase() as 'b']
  return Number(m[1]) * mul
}

describe('request body cap', () => {
  const cfg = fs.readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8')
  const m = /proxyClientMaxBodySize:\s*"([^"]+)"/.exec(cfg)

  test('next.config.ts raises the proxy body cap', () => {
    expect(m).not.toBeNull()
  })

  test('the cap is above every route that declares maxBodyBytes', () => {
    const cap = bytes(m![1])
    const API = path.join(process.cwd(), 'src', 'app', 'api')
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name === 'route.ts' ? [path.join(dir, e.name)] : []))
    let checked = 0
    for (const f of walk(API)) {
      const src = fs.readFileSync(f, 'utf8')
      const consts = new Map<string, number>()
      for (const c of src.matchAll(/const\s+(\w+)\s*=\s*([\d\s*]+)\s*$/gm)) consts.set(c[1], eval(c[2].replace(/[^\d*]/g, ''))) // digits and * only
      const use = /maxBodyBytes:\s*([^,}\n]+)/.exec(src)
      if (!use) continue
      const expr = use[1].trim().replace(/[A-Z_]{3,}/g, (n) => String(consts.get(n) ?? NaN))
      if (!/^[\d\s*+]+$/.test(expr)) continue // not a plain number expression: skip
      const limit = eval(expr) as number
      checked++
      expect(limit, `${path.relative(API, f)} maxBodyBytes ${limit} must be <= cap ${cap}`).toBeLessThanOrEqual(cap)
    }
    expect(checked).toBeGreaterThan(0)
  })
})
