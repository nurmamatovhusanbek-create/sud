import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { inspectChannels } from '@/lib/backup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * POST /api/settings/backup/channels   Body: { passphrase }
 * What each configured channel (the main one and its mirrors) really holds: its pinned manifest, when its chain began, how many pieces are still there
 * and what it lacks compared with the first working channel. Reads Telegram only; nothing is changed, scraped or stored. [privileged: it uses the
 * bot token and needs the passphrase]
 */
export const POST = guard(
  async (req) => {
    const body = (await req.json().catch(() => null)) as { passphrase?: unknown } | null
    const r = await inspectChannels(typeof body?.passphrase === 'string' ? body.passphrase : '')
    return r.ok ? jsonOk({ channels: r.channels }) : jsonFail(r.error, 'bad_request', 400)
  },
  { privileged: true },
)
