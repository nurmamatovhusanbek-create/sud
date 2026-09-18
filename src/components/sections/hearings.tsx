'use client'

/**
 * Hearings section — the prototypeʼs Majlislar: the "Kelgusi majlislar" card
 * with datecards (tear-off date block, weekday + case + judge, time at the
 * right); the nearest hearing is highlighted (.now). Click opens the case
 * detail drawer.
 */

import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, FileSpreadsheet } from 'lucide-react'
import { EmptyBlock, SkRows } from '@/components/proto/primitives'
import { PartialBanner } from '@/components/ui-custom/states'
import { useResource } from '@/hooks/use-resource'
import { getUpcomingHearings, exportHearingsXlsx } from '@/lib/api-client'
import { useAppStore } from '@/lib/store/app-store'
import { useTabCounts } from '@/lib/tab-counts'
import { ListPagination, PageSizeSelect, clampPage, DEFAULT_PAGE_SIZE } from '@/components/ui-custom/list-pagination'
import { toast } from 'sonner'
import type { UpcomingHearingsData } from '@/lib/api-types'
import type { ResourceState } from '@/hooks/use-resource'

const MONTHS_UZ = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']
const WEEKDAYS_UZ = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba']

interface DocketPart {
  day: string
  month: string
  weekday: string
  daysUntil: number
  isoDate: string
  caseNumber: string
  courtName: string
  courtType: string
  hearingTime: string
  judge: string
}

function docketParts(isoDate: string): Omit<DocketPart, 'isoDate' | 'caseNumber' | 'courtName' | 'courtType' | 'hearingTime' | 'judge'> {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return {
    day: String(d).padStart(2, '0'),
    month: MONTHS_UZ[m - 1] ?? '',
    weekday: WEEKDAYS_UZ[date.getDay()],
    daysUntil: Math.ceil((date.getTime() - Date.now()) / 86_400_000),
  }
}

export function HearingsSection() {
  const company = useAppStore((s) => s.activeCompany)
  const setCounts = useTabCounts((s) => s.set)
  // v204 (P-D): pagination + per-page; v204 (P-C): Excel export button
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [exporting, setExporting] = useState(false)
  const { state, refetch } = useResource<UpcomingHearingsData>((signal) => getUpcomingHearings(company?.stir || '', signal), {
    cacheKey: company ? `upcoming:${company.stir}` : undefined,
    enabled: !!company,
  })

  useEffect(() => {
    const handler = () => void refetch()
    window.addEventListener('sud:force-section', handler)
    return () => window.removeEventListener('sud:force-section', handler)
  }, [refetch])

  const view = state as ResourceState<UpcomingHearingsData>
  const loaded = view.status === 'success' || view.status === 'partial'
  const hearings = loaded ? (view.data.hearings as unknown as Record<string, unknown>[]) : []
  const hearingsCount = loaded ? view.data.count ?? hearings.length : undefined

  // v204 (P-D): slice for the current page — nearest hearing across ALL pages
  // is what gets the .now highlight, so compute the overall nearest first.
  const paged = useMemo(
    () => hearings.slice((clampPage(page, hearings.length, pageSize) - 1) * pageSize, clampPage(page, hearings.length, pageSize) * pageSize),
    [hearings, page, pageSize],
  )
  const safePage = clampPage(page, hearings.length, pageSize)

  useEffect(() => {
    if (loaded) setCounts({ hearings: hearingsCount })
  }, [loaded, hearingsCount, setCounts])

  // Cache the nearest hearing into the registry meta (feeds home + bell)
  useEffect(() => {
    if (!company || !loaded) return
    const h = hearings[0]
    if (h?.isoDate) {
      void (async () => {
        const { patchMeta } = await import('@/lib/registry')
        patchMeta(company.stir, {
          nextHearingIso: h.isoDate as string,
          nextHearingCourt: (h.courtName as string) || (h.courtTypeLabel as string) || undefined,
          nextHearingCase: (h.caseNumber as string) || undefined,
          nextHearingTime: (h.hearingTime as string) || undefined,
          nextHearingJudge: (h.judge as string) || undefined,
        })
      })()
    }
  }, [loaded, company, hearings])

  if (!company) return null

  const openCase = (caseNumber: string, courtType: string) => {
    useAppStore.getState().setSection('cases')
    setTimeout(
      () => window.dispatchEvent(new CustomEvent('sud:open-case', { detail: { caseNumber, courtType: courtType || 'economic' } })),
      120,
    )
  }

  if (view.status === 'idle' || view.status === 'loading') return <SkRows n={4} />
  if (view.status === 'error')
    return (
      <EmptyBlock
        icon={<CalendarDays />}
        title="Majlislar olinmadi"
        hint={view.error}
        action={
          <button className="btn btn-outline btn-sm" onClick={() => void refetch()}>
            Qayta urinish
          </button>
        }
      />
    )
  if (view.status === 'empty' || hearings.length === 0)
    return (
      <EmptyBlock
        icon={<CalendarDays />}
        title="Majlis yoʻq"
        hint="Kelgusi 90 kun ichida rejalashtirilgan majlis topilmadi."
      />
    )

  return (
    <div>
      {view.status === 'partial' && <PartialBanner errors={view.partialErrors} onRetry={() => void refetch()} />}
      <div className="p-card rise-c">
        <div className="card-h">
          <div className="ico">
            <CalendarDays />
          </div>
          <h3>Kelgusi majlislar</h3>
          <div className="sp" />
          <span className="faint" style={{ fontSize: 12 }}>3 sud turi · eng yaqini qora bilan</span>
          <PageSizeSelect value={pageSize} onChange={(n) => setPageSize(n)} />
          <button
            className="btn btn-outline btn-sm"
            disabled={exporting}
            onClick={() => {
              setExporting(true)
              void (async () => {
                try {
                  await exportHearingsXlsx(company.stir)
                  toast.success('Excel yuklab olindi')
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Eksport xatosi')
                } finally {
                  setExporting(false)
                }
              })()
            }}
          >
            {exporting ? <span className="spinner" /> : <FileSpreadsheet />}
            <span>Excel</span>
          </button>
        </div>
        <div className="datecards" style={{ flexDirection: 'column' }}>
          {paged.map((h, i) => {
            const iso = h.isoDate as string
            const p = docketParts(iso)
            // v204 (P-D): highlight the OVERALL nearest hearing (index 0 of the
            // full list), not just the first row of the current page
            const near = i === 0 && safePage === 1
            return (
              <div
                key={`${(h.caseNumber as string) || 'h'}-${i}`}
                className={`datecard ${near ? 'now' : ''}`}
                onClick={() => openCase((h.caseNumber as string) || '', (h.courtType as string) || 'economic')}
              >
                <div className="dc-date">
                  <div className="d">{p.day}</div>
                  <div className="m">{p.month}</div>
                </div>
                <div className="dc-body">
                  <b>{(h.courtName as string) || (h.courtTypeLabel as string) || 'Sud'}</b>
                  <span>
                    {p.weekday}
                    {(h.caseNumber as string) ? ` · Ish ${h.caseNumber as string}` : ''}
                    {(h.judge as string) ? ` · ${h.judge as string}` : ''}
                  </span>
                </div>
                <div className="dc-time">{(h.hearingTime as string) || ''}</div>
              </div>
            )
          })}
        </div>
        <ListPagination
          page={safePage}
          pageSize={pageSize}
          total={hearings.length}
          onPageChange={setPage}
        />
      </div>
    </div>
  )
}
