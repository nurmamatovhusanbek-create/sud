import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { parseWatchConfig } from '@/core/watch'
import { readLastRun, readWatchConfig, saveWatchConfig } from '@/lib/watch-store'
import { nextWatchAt, sendWatchTest, startWatchRun, watchRunning, watchedTins } from '@/lib/watch'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * /api/settings/watch: Kuzatuv, the automatic read of the court lists with Telegram messages for what is new (lib/watch).
 *   GET                → the setting, the last run, when the next one is due, whether one is running, which companies are watched
 *   POST {…}           → save (a partial body keeps what it does not name) {enabled, intervalHours, tins, recipients}   [privileged]
 *   POST ?action=run   → read the lists now                                                                              [privileged]
 *   POST ?action=test  → send a test message to the recipients                                                         [privileged]
 * Nothing runs unless `enabled` is true: this is the opt-in the project's rules ask for.
 */
export const GET = guard(async () => {
  const config = readWatchConfig()
  return jsonOk({ config, last: readLastRun(), nextAt: nextWatchAt(), running: watchRunning(), watching: watchedTins(config) })
}, { rateLimit: false })

export const POST = guard(
  async (req) => {
    const action = new URL(req.url).searchParams.get('action')
    if (action === 'run') {
      const r = startWatchRun()
      return r.ok ? jsonOk({ running: true }) : jsonFail(r.error, 'conflict', 409)
    }
    if (action === 'test') {
      const r = await sendWatchTest()
      return r.ok ? jsonOk(r) : jsonFail(r.error ?? 'xato', 'bad_request', 400)
    }
    const body = await req.json().catch(() => null)
    const next = parseWatchConfig(body, readWatchConfig())
    if (!next) return jsonFail('Sozlama notoʻgʻri: davr 1 dan 48 soatgacha, STIR 9 ta raqam, Telegram ID raqam boʻlishi kerak', 'bad_request', 400)
    saveWatchConfig(next)
    return jsonOk({ config: next, nextAt: nextWatchAt() })
  },
  { privileged: true },
)
