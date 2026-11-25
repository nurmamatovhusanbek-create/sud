import 'server-only'
import { getDb } from './db'

/** The bot link's setting (Settings › Telegram › Bot bilan ulanish): kept in the database's `meta` table. Its own file so that Kuzatuv can read the bot's address without importing the poller. */

const META = 'bot_link'

export interface LinkConfig {
  enabled: boolean
  /** the bot's public address, e.g. https://sud-bot.onrender.com (no path) */
  url: string
}
const OFF: LinkConfig = { enabled: false, url: '' }

/** `https://host` only (plain http only for localhost, for a bot run on this computer); no path, no credentials. null = not an address */
export function normalizeBotUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null
  let u: URL
  try {
    u = new URL(input.trim())
  } catch {
    return null
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null
  if (u.username || u.password || !u.hostname) return null
  return u.origin
}

export function readLink(): LinkConfig {
  try {
    const r = getDb().prepare('SELECT v FROM meta WHERE k = ?').get(META)
    if (!r) return OFF
    const c = JSON.parse(String(r.v)) as Partial<LinkConfig>
    const url = normalizeBotUrl(c.url)
    return { enabled: c.enabled === true && !!url, url: url ?? '' }
  } catch {
    return OFF
  }
}

export function saveLink(cfg: LinkConfig): void {
  getDb().prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(META, JSON.stringify(cfg))
}

