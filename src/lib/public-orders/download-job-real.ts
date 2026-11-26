import 'server-only'
import { PUBLIC_INSTANCE_LABEL } from '@/core/public-orders'
import { createDownloadJob } from './download-job'
import { readPdf } from './pdf-store'
import { loadOrderPdf } from './pdf-load'
import { purgeOrders } from './purged-store'
import { allOrders } from './store'

type Job = ReturnType<typeof createDownloadJob>
const g = globalThis as unknown as { __sudOrderDownloadJob?: Job }

/** The one job of this server (on `globalThis`: a route bundle and the presence route must see the same one). */
export const downloadJob = (): Job =>
  (g.__sudOrderDownloadJob ??= createDownloadJob({
    load: (id) => loadOrderPdf(id),
    has: async (id) => !!(await readPdf(id)),
    describe: async (id) => {
      const o = (await allOrders()).find((x) => (x.pdfId ?? '').toLowerCase() === id)
      return { caseNumber: o?.caseNumber ?? '', instance: o ? PUBLIC_INSTANCE_LABEL[o.instance] ?? o.instance : '' }
    },
    purge: async (id, caseNumber) => void (await purgeOrders([{ pdfId: id, caseNumber }])),
  }))

export const downloadJobRunning = (): boolean => !!g.__sudOrderDownloadJob?.isRunning()
