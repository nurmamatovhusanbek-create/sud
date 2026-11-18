import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The UI / logic boundary (docs/ui-split-plan.md, milestone M1).
 *
 * A component under src/components must not reach for data or domain logic itself: no `fetch(`, no `@/lib/api-client`, no
 * registry / store / scraper / orders-store modules. Screens get what they show, and the actions they can take, from a feature
 * hook (src/features/<screen>/…) so the look of a screen can be redesigned without touching how it gets its data.
 *
 * This is a RATCHET. `ui-boundary.baseline.json` lists today's violations (file → forbidden things it still uses):
 *  - a NEW violation (a file or a thing not in the list) fails the test;
 *  - a violation that has been fixed but is still in the list fails too: delete it, so the list only ever shrinks.
 * Regenerate after a deliberate cleanup with:  UPDATE_UI_BASELINE=1 bun test src/lib/__tests__/ui-boundary.test.ts
 */

const ROOT = path.join(process.cwd(), 'src', 'components')
const BASELINE = path.join(import.meta.dir, 'ui-boundary.baseline.json')

/** modules a component may not import (type-only imports are always fine) */
const FORBIDDEN = [
  '@/lib/api-client',
  '@/lib/registry',
  '@/lib/use-registry',
  '@/lib/enrich',
  '@/lib/store',
  '@/lib/billing',
  '@/lib/court-case',
  '@/lib/orginfo',
  '@/lib/chamber',
  '@/lib/stats',
  '@/lib/identity',
  '@/lib/hard-refresh',
  '@/lib/bills-cache',
  '@/lib/bills-snapshot',
  '@/lib/snapshot-store',
  '@/lib/health-store',
  '@/lib/health-registry',
  '@/lib/rating-service',
  '@/lib/public-orders',
  '@/lib/pretenzia',
  '@/lib/documents',
  '@/lib/report',
]

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? (e.name === '__tests__' ? [] : files(p)) : /\.tsx?$/.test(e.name) ? [p] : []
  })
}

export function violationsOf(src: string): string[] {
  const out = new Set<string>()
  for (const m of src.matchAll(/^import\s+(type\s+)?([^'"]*?)from\s+['"]([^'"]+)['"]/gms)) {
    if (m[1]) continue // `import type …`
    const spec = m[3]
    const hit = FORBIDDEN.find((f) => spec === f || spec.startsWith(f + '/'))
    if (hit) out.add(hit)
  }
  if (/(^|[^\w.$])fetch\(/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))) out.add('fetch()')
  return [...out].sort()
}

function current(): Record<string, string[]> {
  const res: Record<string, string[]> = {}
  for (const f of files(ROOT).sort()) {
    const v = violationsOf(fs.readFileSync(f, 'utf8'))
    if (v.length) res[path.relative(process.cwd(), f).replace(/\\/g, '/')] = v
  }
  return res
}

describe('UI boundary (ratchet)', () => {
  const now = current()
  if (process.env.UPDATE_UI_BASELINE) fs.writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n')
  const base: Record<string, string[]> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))

  test('no component gets a NEW way of reaching data or domain logic', () => {
    const added: string[] = []
    for (const [file, v] of Object.entries(now)) for (const x of v) if (!base[file]?.includes(x)) added.push(`${file} → ${x}`)
    expect(added, `move this into a feature hook (docs/ui-split-plan.md):\n${added.join('\n')}`).toEqual([])
  })

  test('the baseline lists only violations that still exist (fixed ones must be removed)', () => {
    const stale: string[] = []
    for (const [file, v] of Object.entries(base)) for (const x of v) if (!now[file]?.includes(x)) stale.push(`${file} → ${x}`)
    expect(stale, `already fixed: delete from ui-boundary.baseline.json:\n${stale.join('\n')}`).toEqual([])
  })

  test('the detector sees what it should', () => {
    expect(violationsOf("import { x } from '@/lib/api-client'\n")).toEqual(['@/lib/api-client'])
    expect(violationsOf("import type { X } from '@/lib/api-client'\n")).toEqual([])
    expect(violationsOf("import { a } from '@/core/dates'\nimport { b } from '@/lib/utils'\n")).toEqual([])
    expect(violationsOf("const r = await fetch('/api/x')\n")).toEqual(['fetch()'])
    expect(violationsOf("// fetch('/api') is documented here\nconst x = 1\n")).toEqual([])
    expect(violationsOf("import {\n  a,\n  b,\n} from '@/lib/store/app-store'\n")).toEqual(['@/lib/store'])
  })
})
