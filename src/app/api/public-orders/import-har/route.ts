import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { extractOrdersFromHar, NotHarError } from '@/lib/public-orders/har-import'
import { readPdf, writePdf } from '@/lib/public-orders/pdf-store'
import { readHidden, setHidden } from '@/lib/public-orders/hidden-store'
import { allOrders, appendOrders } from '@/lib/public-orders/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** A HAR saved with content holds every file of the session; a long one is a few tens of MB. */
export const MAX_HAR_BYTES = 256 * 1024 * 1024
/** a browser session that opened orders holds a handful of order files; thousands is a crafted file filling the disk */
export const MAX_HAR_FILES = 500

/**
 * POST /api/public-orders/import-har   body: the .har file itself
 *
 * The hand-over for orders public.sud.uz shows only in a pop-up (no download button): the person opens the order in their
 * own browser with DevTools › Network open, exports the log (Network › «Export HAR (sanitized)», or «with sensitive data» if the file contents are missing) and gives it to the app. Each
 * order file in it is stored like an automatic download (`pdf-store`), under the id in the file request's own path; a file this computer already has (same id, same size) and a record already stored are skipped, so overlapping exports are harmless. A HAR with only search answers (no file) stores the records; an order the person cleared that is handed over again is brought back to the lists. Local only:
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
      if (e instanceof NotHarError) return jsonFail('Bu HAR fayl emas — DevTools › Network dagi «Export HAR» bilan saqlangan faylni tanlang', 'not_har', 422)
      return jsonFail('Faylni oʻqib boʻlmadi', 'read_failed', 500)
    }
    // a log of search pages only (the orders were found, no file was opened) is a valid hand-over too: the records alone put the orders on the lists as «Yuklanmagan»
    if (!found.files.length && !found.orders.length) {
      const why = found.noContent
        ? 'HAR faylda qaror fayli bor, lekin uning ichi saqlanmagan: «Export HAR (with sensitive data)» bilan qayta saqlang'
        : 'HAR faylda qaror fayli ham, qarorlar roʻyxati (qidiruv natijasi) ham topilmadi: Network ochiq turib sahifani yangilang va qarorlarni qidiring yoki oching, soʻng HAR ni saqlang'
      return jsonFail(why, 'no_order_file', 422)
    }
    if (found.files.length > MAX_HAR_FILES) return jsonFail(`HAR faylda juda koʻp qaror fayli (${found.files.length}); bir martada ${MAX_HAR_FILES} tagacha`, 'too_many', 422)
    // Several exports of the same browser session (a log kept over 5 of 100 pages, then the next 5) overlap: what this computer already has is NOT written again
    // (a published order never changes: the same id with the same size is the same file). Only new files and new or changed records are stored; the rest is counted.
    const saved: { id: string; size: number }[] = []
    const skipped: string[] = []
    let added = 0
    try {
      for (const f of found.files) {
        const have = await readPdf(f.id)
        if (have && have.length === f.bytes.length) {
          skipped.push(f.id)
          continue
        }
        await writePdf(f.id, f.bytes, { name: f.filename ?? undefined, via: 'import' })
        saved.push({ id: f.id, size: f.bytes.length })
      }
      // the records the browser's own searches returned: they put each file on its card (case number, court, instance…)
      const stored = new Map((await allOrders()).map((o) => [o.id, JSON.stringify(o)]))
      const fresh = found.orders.filter((o) => stored.get(o.id) !== JSON.stringify(o))
      await appendOrders(fresh)
      added = fresh.length
    } catch {
      return jsonFail('Faylni saqlab boʻlmadi', 'write_failed', 500)
    }
    // handing an order over AGAIN is a deliberate act: one the person cleared («Tozalash») comes back onto the lists (its record never left the store)
    let restored = 0
    try {
      const hidden = await readHidden()
      const again = [...new Set([...found.orders.map((o) => o.pdfId), ...found.files.map((f) => f.id)].filter((id): id is string => !!id && hidden.has(id.toLowerCase())))]
      if (again.length) restored = (await setHidden('restore', again)).changed
    } catch { /* interface state only: the import itself succeeded */ }
    // which saved files now have a card (a record whose pdfId is the file's id, from this HAR or from an earlier one)
    const known = new Set([...found.orders.map((o) => o.pdfId), ...(await allOrders()).map((o) => o.pdfId)])
    const matched = saved.filter((x) => known.has(x.id)).map((x) => x.id)
    console.log(`[orders-har] ${saved.length} PDF saved, ${skipped.length} already here, ${added} of ${found.orders.length} order records added, ${matched.length} PDF matched to a record (${saved.length - matched.length} without a record), ${restored} brought back from «Tozalangan»`)
    return jsonOk({ saved, skipped: skipped.length, matched, orders: added, restored, seen: found.seen })
  },
  { maxBodyBytes: MAX_HAR_BYTES + 1024 * 1024 },
)
