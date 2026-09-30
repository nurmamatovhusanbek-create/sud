import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Every API route must go through guard() (host check → cross-site check → auth → rate limit) and run on the Node
 * runtime, dynamically. The dangerous doors must also be `privileged`. A new route that forgets any of this fails here.
 */

const API = path.join(process.cwd(), 'src', 'app', 'api')
const routes: string[] = []
;(function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name === 'route.ts') routes.push(p)
  }
})(API)

const rel = (p: string) => path.relative(API, p).replace(/\\/g, '/')

// [route, method] pairs that change the machine or the app
const PRIVILEGED = new Set(['settings/update/route.ts:POST', 'settings/workers/route.ts:POST', 'settings/workers/route.ts:DELETE', 'settings/workers/test/route.ts:POST', 'tor-status/route.ts:POST'])

describe('API routes', () => {
  test('there are routes to check', () => expect(routes.length).toBeGreaterThan(15))

  for (const file of routes) {
    const src = fs.readFileSync(file, 'utf8')
    const name = rel(file)
    test(`${name}: every handler is wrapped in guard()`, () => {
      const handlers = [...src.matchAll(/export\s+(?:const|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE)\b([^\n]*)/g)]
      expect(handlers.length).toBeGreaterThan(0)
      for (const h of handlers) {
        expect(h[0]).toMatch(/=\s*guard\(/) // `export async function X` (unguarded) does not match
      }
    })
    test(`${name}: node runtime + force-dynamic`, () => {
      expect(src).toMatch(/export const runtime\s*=\s*['"]nodejs['"]/)
      expect(src).toMatch(/export const dynamic\s*=\s*['"]force-dynamic['"]/)
    })
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const line = src.split('\n').find((l) => new RegExp(`^export const ${m}\\b`).test(l))
      if (!line) continue
      test(`${name}: ${m} ${PRIVILEGED.has(`${name}:${m}`) ? 'is privileged' : 'is not marked privileged by mistake'}`, () => {
        expect(/privileged:\s*true/.test(line)).toBe(PRIVILEGED.has(`${name}:${m}`))
      })
    }
  }
})
