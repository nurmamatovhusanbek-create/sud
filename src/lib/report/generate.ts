'use client'

/**
 * Company report — the user-facing action.
 *
 * openCompanyReport(stir) is called from a click. It
 *  1. opens the print window IMMEDIATELY (a window.open seconds after the click is
 *     rejected by popup blockers, and scraping can take that long),
 *  2. gathers everything in parallel — reusing the app's own cache, so a company you
 *     already browsed is instant — with a timeout per source,
 *  3. builds the model and the document and prints it.
 *
 * A source that fails or times out does not abort the report: the model records it
 * and the report says so, in place, instead of printing a misleading zero.
 */

import { toast } from 'sonner'
import { getCompanyInfo, getStats, getUpcomingHearings, searchCases } from '@/lib/api-client'
import type { ApiResult, CompanyInfoData, CompanyStats, CourtCase, UpcomingHearingsData } from '@/lib/api-types'
import { getCached, setCached } from '@/lib/cache'
import { escapeHtml, isDarkTheme, openPrintWindow, palette, printIntoWindow } from '@/lib/print'
import { getRecord } from '@/lib/registry'
import { buildReportDoc } from './doc'
import { collectFontKit } from './fonts'
import { buildReportModel } from './model'

/** Scraping the court portals is slow; give each source this long before calling it failed. */
const SOURCE_TIMEOUT_MS = 90_000
const COURTS = ['economic', 'civil', 'administrative'] as const

const inFlight = new Set<string>()

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${Math.round(ms / 1000)} soniyada javob kelmadi`)), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

interface Loaded<T> {
  data: T | null
  error?: string
}

/** One source: the app's cache first, else a live call (which then feeds the same cache). */
async function load<T>(key: string | null, fetcher: () => Promise<ApiResult<T>>): Promise<Loaded<T>> {
  if (key) {
    const hit = getCached<T>(key)
    if (hit !== null) return { data: hit }
  }
  try {
    const res = await withTimeout(fetcher(), SOURCE_TIMEOUT_MS)
    if (res.ok) {
      if (key) setCached(key, res.data)
      return { data: res.data }
    }
    return { data: null, error: res.error }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'nomaʼlum xato' }
  }
}

function loadingPage(dark: boolean): string {
  const p = palette(dark)
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8"><title>Hisobot tayyorlanmoqda…</title><style>
  html,body{height:100%;margin:0;background:${p.bg};color:${p.t2};font:600 14px -apple-system,"Segoe UI",Roboto,Arial,sans-serif}
  body{display:grid;place-items:center;text-align:center}
  .s{width:26px;height:26px;margin:0 auto 14px;border-radius:50%;border:3px solid ${p.borderSoft};border-top-color:${p.accent};animation:r .8s linear infinite}
  small{display:block;margin-top:6px;font-weight:500;color:${p.t3}}
  @keyframes r{to{transform:rotate(360deg)}}
  </style></head><body><div><div class="s"></div>Kompaniya hisoboti tayyorlanmoqda…<small>Manbalardan maʼlumot yigʻilmoqda. Bu bir necha soniya olishi mumkin.</small></div></body></html>`
}

function failedPage(dark: boolean, message: string): string {
  const p = palette(dark)
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8"><title>Hisobot tayyor emas</title><style>
  html,body{height:100%;margin:0;background:${p.bg};color:${p.t1};font:600 14px -apple-system,"Segoe UI",Roboto,Arial,sans-serif}
  body{display:grid;place-items:center;text-align:center;padding:24px}
  small{display:block;margin-top:8px;font-weight:500;color:${p.t2};max-width:420px}
  </style></head><body><div>Hisobotni tayyorlab boʻlmadi<small>${escapeHtml(message)}</small></div></body></html>`
}

/**
 * Build and print the company report for `stir`. Call it directly from a click handler.
 * Resolves when the print dialog has been handed over (or the attempt failed and said so).
 */
export async function openCompanyReport(stir: string): Promise<void> {
  if (inFlight.has(stir)) {
    toast.info('Hisobot allaqachon tayyorlanmoqda')
    return
  }

  const dark = isDarkTheme()
  let w: Window
  try {
    w = openPrintWindow('width=980,height=1100')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Chop etish oynasini ochib boʻlmadi')
    return
  }
  w.document.open()
  w.document.write(loadingPage(dark))
  w.document.close()

  inFlight.add(stir)
  const toastId = toast.loading('Kompaniya hisoboti tayyorlanmoqda…', { description: 'Manbalardan maʼlumot yigʻilmoqda' })
  try {
    const [info, stats, hearings, ...courtLists] = await Promise.all([
      load<CompanyInfoData>(`company-info:${stir}`, () => getCompanyInfo(stir)),
      load<CompanyStats>(`stats:${stir}`, () => getStats(stir)),
      load<UpcomingHearingsData>(`upcoming:${stir}`, () => getUpcomingHearings(stir)),
      ...COURTS.map((ct) =>
        load<{ cases: CourtCase[] }>(`court:${ct}:tin:${stir}`, () => searchCases({ courtType: ct, mode: 'tin', value: stir })),
      ),
    ])

    // the raw case list only enriches the report (claim amounts): partial is fine, all-failed is a gap
    const okLists = courtLists.filter((l) => l.data)
    const cases = okLists.length ? okLists.flatMap((l) => l.data!.cases ?? []) : null

    const failed = {
      info: info.error,
      stats: stats.error,
      cases: okLists.length ? undefined : courtLists.find((l) => l.error)?.error,
      hearings: hearings.error,
    }

    if (!info.data && !stats.data && !hearings.data && cases === null) {
      const why = info.error || stats.error || 'manbalar javob bermadi'
      if (!w.closed) {
        w.document.open()
        w.document.write(failedPage(dark, why))
        w.document.close()
      }
      toast.error('Hisobot uchun maʼlumot olinmadi', { id: toastId, description: why })
      return
    }

    if (w.closed) {
      toast.dismiss(toastId)
      toast.info('Hisobot oynasi yopilgan — bekor qilindi')
      return
    }

    const model = buildReportModel({
      stir,
      generatedAt: new Date(),
      info: info.data,
      stats: stats.data,
      cases,
      hearings: hearings.data?.hearings ?? null,
      bills: getRecord(stir)?.meta ?? null,
      failed,
    })
    const fonts = collectFontKit()
    const html = buildReportDoc(model, { dark, fontFaceCss: fonts.css, fontFamily: fonts.sans, fontMono: fonts.mono })

    printIntoWindow(w, html)
    toast.success('Hisobot tayyor', {
      id: toastId,
      description: model.notes.length ? `${model.notes.length} ta manba javob bermadi — hisobotda koʻrsatilgan` : 'Chop etish oynasida «PDF sifatida saqlash»ni tanlang',
    })
  } catch (e) {
    try { w.close() } catch { /* already closed */ }
    toast.error(e instanceof Error ? e.message : 'Hisobotni tayyorlab boʻlmadi', { id: toastId })
  } finally {
    inFlight.delete(stir)
  }
}
