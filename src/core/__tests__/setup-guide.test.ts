import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import { GUIDE, guideMarkdown } from '../setup-guide'

describe('the setup guide', () => {
  test('docs/QOLLANMA.md is exactly what the app shows (run `bun run guide` after editing core/setup-guide.ts)', () => {
    const file = fs.readFileSync(new URL('../../../docs/QOLLANMA.md', import.meta.url), 'utf8')
    expect(file).toBe(guideMarkdown())
  })

  test('every section has a title and something to read; ids are unique; actions are numbered by the reader, not by hand', () => {
    expect(new Set(GUIDE.map((s) => s.id)).size).toBe(GUIDE.length)
    for (const s of GUIDE) {
      expect(s.title.length).toBeGreaterThan(5)
      expect((s.steps?.length ?? 0) + (s.table?.rows.length ?? 0)).toBeGreaterThan(0)
      for (const st of [...(s.steps ?? []), ...(s.more?.steps ?? [])]) expect(st.text).not.toMatch(/^\d+[.)]\s/)
    }
  })

  test('the owner\'s writing rules: ʻ and ʼ, no straight apostrophe inside a word, no em dash', () => {
    const md = guideMarkdown()
    expect(md).not.toContain('—')
    expect(md).not.toMatch(/[A-Za-z]'[a-z]/) // «oʻ», «Mini Appʼda»: never o'
  })

  test('every «N-boʻlim» it mentions is a section that exists and is the one meant', () => {
    const md = guideMarkdown()
    const want: Record<number, RegExp> = { 2: /bot yaratish/i, 3: /kanal/i, 5: /parol/i, 16: /almashtirish/i }
    let seen = 0
    for (const m of md.matchAll(/(\d+)-boʻlim/g)) {
      const n = Number(m[1])
      expect(n).toBeGreaterThan(0)
      expect(n).toBeLessThanOrEqual(GUIDE.length)
      if (want[n]) expect(GUIDE[n - 1]!.title).toMatch(want[n]!)
      seen++
    }
    expect(seen).toBeGreaterThan(5)
  })

  test('it names every setting the person has to type, in the order the work happens', () => {
    const order = ['@BotFather', '@getidsbot', 'Bot tokeni', 'Zaxiralash', 'Avtomatik zaxirani yoqish', 'Kuzatuv', 'BOT_TOKEN', 'SUD_PASSPHRASE', 'ALLOWED_USER_IDS', '/health']
    const md = guideMarkdown()
    let at = -1
    for (const w of order) {
      const k = md.indexOf(w, at + 1)
      expect(k).toBeGreaterThan(at)
      at = k
    }
  })
})
