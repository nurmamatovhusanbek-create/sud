import 'server-only'
import { allOrders } from './store'
import { readHidden, setHidden } from './hidden-store'
import { purgeOrders } from './purged-store'
import { removePdf } from './pdf-store'

/**
 * «Tozalangan» › «Butunlay oʻchirish»: every CLEARED order is removed in its entirety. Its record leaves the metadata (a purge
 * tombstone, so the channels and the bot forget it too, see purged-store), its PDF file is deleted from the disk, and it leaves
 * the cleared set. The ONLY door that deletes an order file. The records stay in the shards (append-only) and can be brought
 * back with `restorePurged`, but a deleted file is gone: such an order comes back as «yuklanmagan» and can be downloaded again.
 * Returns how many orders left and how many files were deleted. Local only: touches no site.
 */
export async function purgeHiddenOrders(): Promise<{ purged: number; files: number }> {
  const hidden = await readHidden()
  if (!hidden.size) return { purged: 0, files: 0 }
  const items: Array<{ pdfId: string; caseNumber: string }> = []
  for (const o of await allOrders()) {
    if (o.pdfId && hidden.has(o.pdfId.toLowerCase())) items.push({ pdfId: o.pdfId, caseNumber: o.caseNumber })
  }
  const purged = await purgeOrders(items)
  let files = 0
  for (const id of hidden) if (await removePdf(id)) files++ // also a file whose record is gone
  await setHidden('restore', [...hidden]) // nothing is «cleared» any more
  return { purged, files }
}
