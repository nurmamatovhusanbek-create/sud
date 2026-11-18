import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { extractOrdersFromHar, NotHarError } from '@/lib/public-orders/har-import'
import { writePdf } from '@/lib/public-orders/pdf-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** A HAR saved with content holds every file of the session; a long one is a few tens of MB. */
export const MAX_HAR_BYTES = 256 * 1024 * 1024

/**
 * POST /api/public-orders/import-har   body: the .har file itself
 *
 * The hand-over for orders public.sud.uz shows only in a pop-up (no download button): the person opens the order in their
 * own browser with DevTools › Network open, saves the log («Save all as HAR with content») and gives it to the app. Each
 * order file in it is stored like an automatic download (`pdf-store`), under the id in the file request's own path. Local only:
 * nothing is requested from any site; cookies/tokens in the HAR are never read. See lib/public-orders/har-import.
 */
export const POST = guard(
  async (req) => {
    const raw = new Uint8Array(await req.arrayBuffer())
    if (!raw.length) return jsonFail('Fayl boʻsh', 'bad_request', 400)
    if (raw.length > MAX_HAR_BYTES) return jsonFail('Fayl juda katta', 'too_large', 413)
    let found
    try {
      found = extractOrdersFromHar(raw)
    } catch (e) {
      if (e instanceof NotHarError) return jsonFail('Bu HAR fayl emas — DevTools › Network dan «Save all as HAR with content» bilan saqlangan faylni tanlang', 'not_har', 422)
      return jsonFail('Faylni oʻqib boʻlmadi', 'read_failed', 500)
    }
    if (!found.files.length) {
      const why = found.noContent
        ? 'HAR faylda qaror fayli bor, lekin uning ichi saqlanmagan: «Save all as HAR with content» ni tanlang (oddiy «Save as HAR» emas)'
        : 'HAR faylda qaror fayli topilmadi: Network ochiq turib qarorni oching, soʻng HAR ni saqlang'
      return jsonFail(why, 'no_order_file', 422)
    }
    const saved: { id: string; size: number }[] = []
    try {
      for (const f of found.files) {
        await writePdf(f.id, f.bytes, { name: f.filename ?? undefined, via: 'import' })
        saved.push({ id: f.id, size: f.bytes.length })
      }
    } catch {
      return jsonFail('Faylni saqlab boʻlmadi', 'write_failed', 500)
    }
    return jsonOk({ saved, seen: found.seen })
  },
  { maxBodyBytes: MAX_HAR_BYTES + 1024 * 1024 },
)
