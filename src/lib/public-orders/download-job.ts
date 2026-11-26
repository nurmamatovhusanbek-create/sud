import 'server-only'
import { isOrderFileId, type DownloadJobState as JobState, type DownloadProblem as Problem, type DownloadProblemKind as ProblemKind } from '@/core/public-orders'
import type { OrderPdf } from './order-pdf'
import { ManualDownloadRequired, NotPdfError } from './order-pdf'

/**
 * «Barchasini yuklash» as a SERVER job. It used to be a loop inside the Qarorlar page: leave the page (another tab, a company card) and the loop was gone with
 * it. Now the page only starts it and watches: the job lives on `globalThis` (like the bills job), one at a time, and the page reads its state every couple of
 * seconds (`GET /api/public-orders/download-job`), so it survives any navigation and a closed tab (`/api/presence` counts it as busy, so Sud.bat does not stop under it).
 *
 * What it does with the orders that cannot be saved (the person asked: «just skip them, show what is wrong at the end»):
 *   - the site wants a person (`ManualDownloadRequired`): the order is listed with the way out (HAR / hand-over). The shared loader then rests for 30 minutes
 *     (every further try would burn captchas on a shut door), so the rest of the list is NOT tried now: it is counted as `deferred`, the job ends, and pressing the
 *     button again later continues with what is still not downloaded;
 *   - «Fayl PDF emas»: asked once more; if the second answer is not a PDF either, the order is REMOVED from the metadata (`purged-store`) and listed as removed;
 *   - any other failure (a timeout, a 5xx): listed with its reason and skipped;
 *   - the file arrived but could not be kept on disk: systematic, so the job stops and says why.
 * Pure orchestration over injected functions (`createDownloadJob`), tested without a network; the real one is `downloadJob()`.
 */

export type { DownloadJobState as JobState, DownloadProblem as Problem, DownloadProblemKind as ProblemKind } from '@/core/public-orders'

export interface JobDeps {
  /** `retryAuto`: reopen the loader's rest after a refusal (the job probes the next order instead of giving up on the whole list) */
  load: (pdfId: string, retryAuto: boolean) => Promise<OrderPdf>
  /** the order's case number and instance (for the report); unknown ids give empty strings */
  describe: (pdfId: string) => Promise<{ caseNumber: string; instance: string }>
  purge: (pdfId: string, caseNumber: string) => Promise<void>
  /** is the file on disk already? */
  has: (pdfId: string) => Promise<boolean>
  now?: () => number
}

const fresh = (): JobState => ({ phase: 'idle', total: 0, done: 0, ok: 0, removed: 0, deferred: 0, problems: [], current: '', note: '', startedAt: 0, finishedAt: 0 })

export const MAX_JOB = 5000
/** the site refused this many orders in a row: it is not about one order, so the rest is left for later (every probe costs up to three captcha sessions) */
export const MAX_REFUSED_IN_A_ROW = 3
/** the same failure for this many orders in a row is not about the orders (a worker that is out of date, a captcha host that is down): the rest is left and the reason is said once */
export const MAX_SAME_FAILURE_IN_A_ROW = 3

export function createDownloadJob(deps: JobDeps) {
  const now = deps.now ?? Date.now
  let st: JobState = fresh()
  let stopFlag = false
  let running: Promise<void> | null = null

  async function run(ids: string[]): Promise<void> {
    let refusedInARow = 0
    let sameFailure = { message: '', n: 0 }
    for (let i = 0; i < ids.length; i++) {
      if (stopFlag) {
        st.phase = 'stopped'
        break
      }
      const id = ids[i]!
      const d = await deps.describe(id)
      st.current = d.caseNumber ? `${d.caseNumber}${d.instance ? ` · ${d.instance}` : ''}` : id
      const bad = (kind: ProblemKind, message: string): void => void st.problems.push({ pdfId: id, caseNumber: d.caseNumber, instance: d.instance, kind, message })
      try {
        if (await deps.has(id)) {
          st.done++
          continue
        }
        let r: OrderPdf
        // after a refusal the next order is a PROBE (the loader's rest is reopened): one order may be refused while the next is fine
        const probe = refusedInARow > 0
        try {
          r = await deps.load(id, probe)
        } catch (e) {
          if (!(e instanceof NotPdfError)) throw e
          r = await deps.load(id, probe) // «Fayl PDF emas» once more: a half answer is not a verdict
        }
        refusedInARow = 0
        sameFailure = { message: '', n: 0 }
        if (!r.saved) {
          st.note = `PDF olindi, lekin kompyuterga saqlanmadi: ${r.saveError || 'sababi nomaʼlum'}. Yuklash toʻxtatildi.`
          break
        }
        st.ok++
      } catch (e) {
        if (e instanceof ManualDownloadRequired) {
          bad('manual', 'public.sud.uz bu qarorni qoʻlda yuklashni talab qildi: brauzerda oching va HAR faylini «HAR fayldan yuklash» orqali bering')
          refusedInARow++
          if (refusedInARow >= MAX_REFUSED_IN_A_ROW) {
            st.deferred = ids.length - i - 1 // refused again and again: the site is closed for now, the rest is for a later press
            st.done++
            break
          }
          // otherwise skip it and go on: the next order is a probe
          st.done++
          continue
        }
        if (e instanceof NotPdfError && e.what.document) {
          // the order EXISTS, the site just gives it as another kind of file (Word, an image): never removed, listed with what it is so the person can open it by hand
          bad('other', `${e.message}. Qaror mavjud, lekin PDF emas: public.sud.uz da oching`)
        } else if (e instanceof NotPdfError) {
          // an error page, JSON or empty answer on both tries: nothing to keep. Removed, and the report says WHAT the site sent
          await deps.purge(id, d.caseNumber).catch(() => {})
          st.removed++
          bad('removed', `Sayt ikki urinishda ham PDF bermadi (${e.what.label}${e.what.preview ? `: «${e.what.preview}»` : ''}, ${e.size} bayt): qaror maʼlumotlardan olib tashlandi`)
        } else {
          const message = e instanceof Error ? e.message : 'yuklab boʻlmadi'
          bad('other', message)
          sameFailure = sameFailure.message === message ? { message, n: sameFailure.n + 1 } : { message, n: 1 }
          if (sameFailure.n >= MAX_SAME_FAILURE_IN_A_ROW) {
            st.deferred = ids.length - i - 1
            st.note = `Ketma-ket ${sameFailure.n} ta qaror bir xil sabab bilan yuklanmadi, shuning uchun qolganlari urinib koʻrilmadi. Sabab: ${message}`
            st.done++
            break
          }
        }
      }
      st.done++
    }
    st.current = ''
    st.finishedAt = now()
    if (st.phase === 'running') st.phase = 'done'
    running = null
  }

  return {
    state: (): JobState => ({ ...st, problems: [...st.problems] }),
    isRunning: (): boolean => st.phase === 'running',
    start(ids: string[]): { ok: true } | { ok: false; error: string } {
      if (st.phase === 'running') return { ok: false, error: 'Yuklash allaqachon ketmoqda' }
      const list = [...new Set(ids.filter((x) => typeof x === 'string' && isOrderFileId(x)).map((x) => x.toLowerCase()))]
      if (!list.length) return { ok: false, error: 'Yuklanadigan qaror yoʻq' }
      if (list.length > MAX_JOB) return { ok: false, error: `Bir martada ${MAX_JOB} tagacha qaror` }
      stopFlag = false
      st = { ...fresh(), phase: 'running', total: list.length, startedAt: now() }
      running = run(list).catch((e) => {
        st.note = `Kutilmagan xato: ${e instanceof Error ? e.message : String(e)}`
        st.phase = 'stopped'
        st.finishedAt = now()
        running = null
      })
      return { ok: true }
    },
    /** stop after the order in flight */
    stop(): void {
      if (st.phase === 'running') stopFlag = true
    },
    /** dismiss a finished report */
    clear(): void {
      if (st.phase !== 'running') st = fresh()
    },
    /** tests: wait for the running job */
    settled: (): Promise<void> => running ?? Promise.resolve(),
  }
}
