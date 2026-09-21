'use client'

/**
 * Cases section — the prototypeʼs Sud ishlari: search + court-type seg + PDF
 * row in one card, case rows as list rows (lead icon, mono number, badge,
 * amount), and the detail drawer with the prototypeʼs four detail sections:
 * Umumiy strip, Tomonlar (cross-company party links), Majlislar tarixi
 * timeline, Qarorlar, Instansiyalar. No documents section (parked §13.1).
 *
 * v204 (P-D): the three per-court useResource fetches are lifted INTO the
 * parent, which holds ONE merged, filtered case list across the selected
 * court types — enabling pagination (page + per-page) and the Excel export.
 * Rows carry their own courtType, so «Barchasi» mode now opens each case in
 * the court type it actually came from (was hardcoded 'economic').
 *
 * v204 (P-C): the toolbar PDF opens a real print dialog via lib/print.ts and
 * a new Excel button downloads a server-built .xlsx (court-cases/export).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, FileSpreadsheet, Gavel, Scale, Search, User, Wallet, Link2 } from 'lucide-react'
import { EmptyBlock, SkRows, Seg, familyBadgeClass } from '@/components/proto/primitives'
import { ScrapeProgress, SCRAPE_CFG } from '@/components/proto/scrape-progress'
import { openProtoDrawer, closeProtoDrawer } from '@/components/proto/drawer'
import { PartialBanner, ErrorState } from '@/components/ui-custom/states'
import { ListPagination, clampPage } from '@/components/ui-custom/list-pagination'
import { useResource } from '@/hooks/use-resource'
import { getCaseDetail, searchCases, searchCompanies, exportCasesXlsx } from '@/lib/api-client'
import { printHtml, escapeHtml } from '@/lib/print'
import { useAppStore } from '@/lib/store/app-store'
import type { CourtType, CourtCase, FullCaseData, CaseDetail as FullCaseGeneral } from '@/lib/court-case-types'
import type { ResourceState } from '@/hooks/use-resource'
import { CASE_STATUSES, HEARING_STATUSES } from '@/lib/court-case-types'
import { toast } from 'sonner'

const COURT_SEG: { key: string; label: string }[] = [
  { key: 'all', label: 'Barchasi' },
  { key: 'economic', label: 'Iqtisodiy' },
  { key: 'civil', label: 'Fuqarolik' },
  { key: 'administrative', label: "Maʼmuriy" },
]

const COURT_TYPES: CourtType[] = ['economic', 'civil', 'administrative']

function statusEn(s: string | null | undefined): string {
  if (!s) return ''
  return CASE_STATUSES[s]?.en ?? s
}
function hearingEn(s: string | null | undefined): string {
  if (!s) return ''
  return HEARING_STATUSES[s]?.en ?? s
}
function hearingDone(s: string | null | undefined): boolean {
  if (!s) return false
  return /ЎТКАЗИЛГАН|Якун|БЎЛИБ ЎТДИ|ўтказилган|yakun|bo'lib/i.test(s)
}

type CaseRow = CourtCase & { hearingTime?: string }

// ---- Print helpers (v204 P-C) ----------------------------------------------------

function caseDetailHtml(caseNumber: string, d: FullCaseData): string {
  const g = d.general
  const fi = d.firstInstance
  const ap = d.appellate
  const ca = d.cassation
  const kv = (k: string, v: string | undefined | null) =>
    `<div class="pr-kv"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v || '-')}</span></div>`

  const allHearings = [
    ...(fi?.hearings ?? []),
    ...(ap?.hearings ?? []),
    ...(ca?.hearings ?? []),
  ].sort((a, b) => (a.date || '').localeCompare(b.date || ''))

  const decisions = [fi?.decision, ap?.decision, ca?.decision].filter(Boolean)

  const parties = `
    <div class="pr-sec">Tomonlar</div>
    ${kv('Daʼvogar', g?.plaintiff)}${g?.plaintiffTin ? kv('Daʼvogar STIR', g.plaintiffTin) : ''}
    ${kv('Javobgar', g?.defendant)}${g?.defendantTin ? kv('Javobgar STIR', g.defendantTin) : ''}`

  const hearingsSec = allHearings.length
    ? `<div class="pr-sec">Majlislar tarixi</div>
       <table class="pr-table"><thead><tr><th>Sana</th><th>Vaqt</th><th>Holat</th><th>Zal</th></tr></thead><tbody>
       ${allHearings
         .map(
           (h) =>
             `<tr><td>${escapeHtml(h.date || '-')}</td><td>${escapeHtml(h.time || '-')}</td><td>${escapeHtml(
               hearingEn(h.status) || h.status || '-',
             )}</td><td>${escapeHtml(h.courtroom || '-')}</td></tr>`,
         )
         .join('')}
       </tbody></table>`
    : ''

  const decisionsSec = decisions.length
    ? `<div class="pr-sec">Qarorlar</div>
       <table class="pr-table"><thead><tr><th>Sana</th><th>Mazmun</th></tr></thead><tbody>
       ${decisions.map((dec) => `<tr><td style="white-space:nowrap">${escapeHtml(dec!.date || '-')}</td><td>${escapeHtml(dec!.text || '-')}</td></tr>`).join('')}
       </tbody></table>`
    : ''

  const instances = [
    { name: 'Birinchi instansiya', d: fi },
    { name: 'Apellyatsiya', d: ap },
    { name: 'Kassatsiya', d: ca },
  ]
    .map((inst) => {
      const has = (inst.d?.hearings.length ?? 0) > 0 || !!inst.d?.decision
      const outcome = inst.d?.decision?.text ? 'Koʻrib chiqilgan' : inst.d?.appellateOutcome || (has ? 'Yozuvlar bor' : "Maʼlumot yoʻq")
      return kv(inst.name, outcome)
    })
    .join('')

  return `
    <div class="pr-head">
      <div>
        <div class="pr-eyebrow">Ish tafsiloti</div>
        <div class="pr-title">${escapeHtml(caseNumber)}</div>
      </div>
      <div class="pr-meta">
        ${g?.caseStatus ? `<div><span class="pr-badge">${escapeHtml(statusEn(g.caseStatus) || g.caseStatus)}</span></div>` : ''}
        ${g?.court ? `<div style="margin-top:4px">${escapeHtml(g.court)}</div>` : ''}
      </div>
    </div>
    <div class="pr-sec">Umumiy maʼlumot</div>
    ${kv('Sudya', g?.judge)}
    ${kv('Daʼvo summasi', g?.claimAmount)}
    ${kv('Sud', g?.court)}
    ${kv('Ish turi', g?.caseType)}
    ${parties}
    ${hearingsSec}
    ${decisionsSec}
    <div class="pr-sec">Instansiyalar</div>
    ${instances}`
}

function caseListHtml(
  title: string,
  rows: { caseNumber: string; courtName?: string; judge?: string; claimAmount?: string; caseStatus?: string; date?: string }[],
): string {
  return `
    <div class="pr-head">
      <div>
        <div class="pr-eyebrow">Sud ishlari</div>
        <div class="pr-title">${escapeHtml(title)}</div>
      </div>
      <div class="pr-meta">${rows.length} ta ish</div>
    </div>
    <table class="pr-table">
      <thead><tr><th>Ish raqami</th><th>Sud</th><th>Sudya</th><th>Summa</th><th>Holat</th><th>Sana</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (r) =>
              `<tr><td class="mono">${escapeHtml(r.caseNumber || '-')}</td><td>${escapeHtml(r.courtName || '-')}</td><td>${escapeHtml(
                r.judge || '-',
              )}</td><td>${escapeHtml(r.claimAmount || '-')}</td><td>${escapeHtml(statusEn(r.caseStatus) || r.caseStatus || '-')}</td><td>${escapeHtml(
                r.date || '-',
              )}</td></tr>`,
          )
          .join('')}
      </tbody>
    </table>`
}

// ---- Case detail drawer --------------------------------------------------------

function partyLink(name: string | undefined, tin: string | undefined, onClose: () => void) {
  if (!name || name === '—' || name === '-') return <span className="faint">-</span>
  const known = tin && /^\d{9}$/.test(tin)
  const open = () => {
    onClose()
    if (known) {
      useAppStore.getState().openCompany(tin)
      return
    }
    void (async () => {
      const res = await searchCompanies(name)
      if (res.ok && res.data.results?.length) {
        useAppStore.getState().openCompany(res.data.results[0].tin, { name: res.data.results[0].name })
      } else {
        toast.warning('Tomon kompaniya sifatida topilmadi')
      }
    })()
  }
  return (
    <button
      className="btn btn-ghost btn-xs"
      style={{ padding: 0, height: 'auto', color: 'var(--info-text)' }}
      onClick={open}
    >
      {name} <Link2 />
    </button>
  )
}

function openCaseDetail(caseNumber: string, courtType: CourtType) {
  openProtoDrawer(
    `Ish ${caseNumber}`,
    <div style={{ textAlign: 'center', padding: '30px 0' }}>
      <span className="spinner" />
      <div className="faint" style={{ marginTop: 10, fontSize: 12.5 }}>Ish tafsilotlari yuklanmoqda…</div>
    </div>,
    '',
  )

  void (async () => {
    const res = await getCaseDetail(courtType, caseNumber)
    if (!res.ok) {
      openProtoDrawer(
        `Ish ${caseNumber}`,
        <div className="alert err">
          <Gavel />
          <div className="at">
            <b>Tafsilotlar olinmadi</b>
            <p>{res.error}</p>
          </div>
        </div>,
        '',
      )
      return
    }
    const d = res.data
    const g = d.general
    const fi = d.firstInstance
    const ap = d.appellate
    const ca = d.cassation
    const close = () => closeProtoDrawer()

    // Merge hearings across instances into one timeline (sorted by date)
    const allHearings = [
      ...(fi?.hearings ?? []),
      ...(ap?.hearings ?? []),
      ...(ca?.hearings ?? []),
    ].sort((a, b) => (a.date || '').localeCompare(b.date || ''))

    const decisions = [fi?.decision, ap?.decision, ca?.decision].filter(Boolean)

    const instances: { name: string; badge?: string; hasData: boolean }[] = [
      { name: 'Birinchi instansiya', badge: fi?.decision?.text ? 'Koʻrib chiqilgan' : fi?.appellateOutcome, hasData: (fi?.hearings.length ?? 0) > 0 || !!fi?.decision },
      { name: 'Apellyatsiya', badge: ap?.decision?.text ? 'Koʻrib chiqilgan' : ap?.appellateOutcome, hasData: (ap?.hearings.length ?? 0) > 0 || !!ap?.decision },
      { name: 'Kassatsiya', badge: ca?.decision?.text ? 'Koʻrib chiqilgan' : ca?.appellateOutcome, hasData: (ca?.hearings.length ?? 0) > 0 || !!ca?.decision },
    ]

    const printCase = () => {
      try {
        printHtml(`Ish ${caseNumber}`, caseDetailHtml(caseNumber, d))
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Chop etib boʻlmadi')
      }
    }

    openProtoDrawer(
      `Ish ${caseNumber}`,
      <div>
        <div style={{ marginBottom: 18, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {g?.caseStatus && <span className={`badge ${familyBadgeClass('neutral')}`} style={{ height: 28, fontSize: 13 }}>{statusEn(g.caseStatus) || g.caseStatus}</span>}
          {g?.caseType && <span className="badge b-neu" style={{ height: 28, fontSize: 13 }}>{g.caseType}</span>}
        </div>

        <div className="detail-sec">
          <span className="eyebrow">Umumiy maʼlumot</span>
          <div className="dstrip">
            <div className="dfield">
              <div className="k"><User />Sudya</div>
              <div className="v">{g?.judge || '-'}</div>
            </div>
            <div className="dfield">
              <div className="k"><Wallet />Daʼvo summasi</div>
              <div className="v mono">{g?.claimAmount || '-'}</div>
            </div>
            <div className="dfield" style={{ minWidth: '100%' }}>
              <div className="k"><Scale />Sud</div>
              <div className="v">{g?.court || '-'}</div>
            </div>
          </div>
        </div>

        <div className="detail-sec">
          <span className="eyebrow">Tomonlar</span>
          <div className="dstrip">
            <div className="dfield">
              <div className="k">Daʼvogar</div>
              <div className="v">{partyLink(g?.plaintiff, g?.plaintiffTin, close)}</div>
              {g?.plaintiffTin ? <div className="faint mono" style={{ fontSize: 11, marginTop: 2 }}>STIR {g.plaintiffTin}</div> : null}
            </div>
            <div className="dfield">
              <div className="k">Javobgar</div>
              <div className="v">{partyLink(g?.defendant, g?.defendantTin, close)}</div>
              {g?.defendantTin ? <div className="faint mono" style={{ fontSize: 11, marginTop: 2 }}>STIR {g.defendantTin}</div> : null}
            </div>
          </div>
        </div>

        {allHearings.length > 0 && (
          <div className="detail-sec">
            <span className="eyebrow">Majlislar tarixi</span>
            <div className="timeline">
              {allHearings.map((h, i) => {
                const done = hearingDone(h.status)
                return (
                  <div className={`tl-item ${done ? 'done' : 'next'}`} key={i}>
                    <b>{h.date} · {h.time || '-'}</b>
                    <div className="m">{hearingEn(h.status) || h.status || '-'}{h.courtroom ? ` · ${h.courtroom}` : ''}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {decisions.length > 0 && (
          <div className="detail-sec">
            <span className="eyebrow">Qarorlar</span>
            <div className="list">
              {decisions.map((dec, i) => (
                <div className="lrow" style={{ cursor: 'default' }} key={i}>
                  <div className="lead"><Gavel /></div>
                  <div className="main-c">
                    <b>{dec!.date || '-'}</b>
                    <div className="sub" style={{ whiteSpace: 'normal' }}>{dec!.text || '-'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="detail-sec">
          <span className="eyebrow">Instansiyalar</span>
          <div className="instances">
            {instances.map((inst) => (
              <div className="inst" key={inst.name}>
                <div className="inst-h">
                  <b>{inst.name}</b>
                  {inst.badge ? <span className="badge b-neu">{inst.badge}</span> : !inst.hasData ? <span className="badge b-neu">Maʼlumot yoʻq</span> : null}
                </div>
                <div className="faint mono" style={{ fontSize: 12 }}>{inst.hasData ? `${inst.name.toLowerCase()} boʻyicha yozuvlar bor` : 'Yozuv topilmadi'}</div>
              </div>
            ))}
          </div>
        </div>

        <button className="btn btn-outline" style={{ width: '100%' }} onClick={printCase}>
          <Download />
          <span>Ish tafsilotini PDF qilish</span>
        </button>
      </div>,
      g?.court || '',
    )
  })()
}

// ---- section (v204: merged list held HERE, not per court) ------------------------

interface MergedRow {
  c: CourtCase
  courtType: CourtType
}

export function CasesSection() {
  const company = useAppStore((s) => s.activeCompany)
  const storeCourtFilter = useAppStore((s) => s.caseCourtFilter)
  const setStoreCourtFilter = useAppStore((s) => s.setCaseCourtFilter)
  const [courtFilter, setCourtFilter] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [exporting, setExporting] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [page, setPage] = useState(1)
  // v18 paginates cases densely (≈8/page); keep the pager visible even on a
  // single page so the count + page-size control are always available.
  const [pageSize, setPageSize] = useState(10)

  const stir = company?.stir || ''
  const courts: CourtType[] = courtFilter === 'all' ? COURT_TYPES : [courtFilter as CourtType]

  // sud:open-case → open the detail drawer from anywhere
  useEffect(() => {
    const openCase = (e: Event) => {
      const d = (e as CustomEvent).detail as { caseNumber?: string; courtType?: string }
      if (d?.caseNumber) openCaseDetail(d.caseNumber, (d.courtType as CourtType) || 'economic')
    }
    window.addEventListener('sud:open-case', openCase)
    return () => window.removeEventListener('sud:open-case', openCase)
  }, [])

  // v18: pizza detail «Ishlarni koʻrish» + mini filter cards land here — apply
  // the one-shot court filter from the store, then clear it so manual seg
  // clicks stay authoritative afterwards.
  useEffect(() => {
    if (storeCourtFilter !== 'all') {
      setCourtFilter(storeCourtFilter)
      setPage(1)
      setStoreCourtFilter('all')
    }
  }, [storeCourtFilter, setStoreCourtFilter])

  // v18: turkum mode «Ishlarni koʻrish» pre-fills the text query
  useEffect(() => {
    const onQuery = (e: Event) => {
      const d = (e as CustomEvent).detail as { query?: string }
      if (d?.query) {
        setQuery(d.query)
        setPage(1)
      }
    }
    window.addEventListener('sud:cases-query', onQuery)
    return () => window.removeEventListener('sud:cases-query', onQuery)
  }, [])

  // v204 (P-D): one useResource per court type, lifted into the parent.
  // Only the SELECTED court types fetch (matches the old per-court mounting);
  // results merge into a single list for filtering, pagination and export.
  const econ = useResource<{ cases: CourtCase[] }>(
    (signal) => searchCases({ courtType: 'economic', mode: 'tin', value: stir }, signal),
    { cacheKey: `court:economic:tin:${stir}`, enabled: !!company && courts.includes('economic') },
  )
  const civ = useResource<{ cases: CourtCase[] }>(
    (signal) => searchCases({ courtType: 'civil', mode: 'tin', value: stir }, signal),
    { cacheKey: `court:civil:tin:${stir}`, enabled: !!company && courts.includes('civil') },
  )
  const adm = useResource<{ cases: CourtCase[] }>(
    (signal) => searchCases({ courtType: 'administrative', mode: 'tin', value: stir }, signal),
    { cacheKey: `court:administrative:tin:${stir}`, enabled: !!company && courts.includes('administrative') },
  )

  const views = useMemo(
    () =>
      [
        { courtType: 'economic' as CourtType, view: econ.state as ResourceState<{ cases: CourtCase[] }>, refetch: econ.refetch, elapsed: econ.elapsed },
        { courtType: 'civil' as CourtType, view: civ.state as ResourceState<{ cases: CourtCase[] }>, refetch: civ.refetch, elapsed: civ.elapsed },
        { courtType: 'administrative' as CourtType, view: adm.state as ResourceState<{ cases: CourtCase[] }>, refetch: adm.refetch, elapsed: adm.elapsed },
      ].filter((v) => courts.includes(v.courtType)),
    [econ.state, civ.state, adm.state, econ.elapsed, civ.elapsed, adm.elapsed, courtFilter],
  )
  const refetchEnabled = () => {
    if (courts.includes('economic') && econ.state.status === 'error') econ.refetch()
    if (courts.includes('civil') && civ.state.status === 'error') civ.refetch()
    if (courts.includes('administrative') && adm.state.status === 'error') adm.refetch()
  }

  // v208: Yangilash previously did NOTHING on this section (no listener).
  // Refetch every enabled court — refetch() drops the client cache entry first.
  const refetchAll = useCallback(() => {
    if (courts.includes('economic')) econ.refetch()
    if (courts.includes('civil')) civ.refetch()
    if (courts.includes('administrative')) adm.refetch()
  }, [econ.refetch, civ.refetch, adm.refetch, courts.join(',')])

  useEffect(() => {
    const handler = () => refetchAll()
    window.addEventListener('sud:force-section', handler)
    return () => window.removeEventListener('sud:force-section', handler)
  }, [refetchAll])

  const anyLoading = views.some((v) => v.view.status === 'idle' || v.view.status === 'loading')
  const allError = views.length > 0 && views.every((v) => v.view.status === 'error')
  const maxElapsed = views.reduce((acc, v) => Math.max(acc, v.elapsed ?? 0), 0)
  const partialErrors = views.flatMap((v) =>
    v.view.status === 'partial'
      ? v.view.partialErrors
      : v.view.status === 'error'
        ? [{ source: v.courtType, error: v.view.error }]
        : [],
  )

  const merged: MergedRow[] = useMemo(
    () =>
      views.flatMap((v) =>
        v.view.status === 'success' || v.view.status === 'partial'
          ? (v.view.data.cases || []).map((c) => ({ c, courtType: v.courtType }))
          : [],
      ),
    [views],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return merged
    return merged.filter(({ c }) =>
      Object.values(c).some((v) => typeof v === 'string' && v.toLowerCase().includes(q)),
    )
  }, [merged, query])

  // Reset to page 1 whenever the list-shaping inputs change
  useEffect(() => {
    setPage(1)
  }, [query, courtFilter, stir])

  const safePage = clampPage(page, filtered.length, pageSize)
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  if (!company) return null

  const printList = () => {
    setPrinting(true)
    try {
      printHtml(
        `Sud ishlari · ${company.name || stir}`,
        caseListHtml(
          company.name || `STIR ${grpSafe(stir)}`,
          filtered.map(({ c }) => ({
            caseNumber: c.caseNumber,
            courtName: c.courtName,
            judge: c.judge,
            claimAmount: c.claimAmount,
            caseStatus: c.caseStatus,
            date: c.hearingDate && c.hearingDate !== '—' && c.hearingDate !== '-' ? c.hearingDate : c.dateFiled,
          })),
        ),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Chop etib boʻlmadi')
    } finally {
      setPrinting(false)
    }
  }

  const exportExcel = () => {
    setExporting(true)
    void (async () => {
      try {
        await exportCasesXlsx({ tin: stir, courtTypes: courts })
        toast.success('Excel yuklab olindi')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Eksport xatosi')
      } finally {
        setExporting(false)
      }
    })()
  }

  return (
    <div className="p-card rise-c">
      <div className="filterbar">
        <div className="f-search">
          <Search />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ish raqami, sudya, tomon yoki bosqich…" />
        </div>
        <Seg options={COURT_SEG} value={courtFilter} onChange={setCourtFilter} />
        <div style={{ flex: 1 }} />
        <button
          className="btn btn-outline btn-sm"
          disabled={printing || filtered.length === 0}
          onClick={printList}
        >
          {printing ? <span className="spinner" /> : <Download />}
          <span>PDF</span>
        </button>
        <button
          className="btn btn-outline btn-sm"
          disabled={exporting || filtered.length === 0}
          onClick={exportExcel}
        >
          {exporting ? <span className="spinner" /> : <FileSpreadsheet />}
          <span>Excel</span>
        </button>
      </div>

      {anyLoading ? (
        merged.length === 0 ? (
          // v18: first load shows the scrape progress card, not a blank skeleton
          <ScrapeProgress {...SCRAPE_CFG.cases} elapsed={maxElapsed} />
        ) : (
          <SkRows n={6} />
        )
      ) : allError ? (
        <ErrorState
          error={(views.find((v) => v.view.status === 'error')?.view as { error: string } | undefined)?.error || 'Xatolik'}
          onRetry={refetchEnabled}
        />
      ) : merged.length === 0 ? (
        <EmptyBlock icon={<Gavel />} title="Ish topilmadi" hint="Tanlangan sud turlarida bu STIR boʻyicha ish topilmadi." />
      ) : filtered.length === 0 ? (
        <EmptyBlock icon={<Search />} title="Filtr boʻyicha natija yoʻq" hint="Boshqa soʻz bilan qidirib koʻring." />
      ) : (
        <>
          <PartialBanner errors={partialErrors} onRetry={refetchEnabled} />
          <div className="list">
            {paged.map(({ c, courtType }, i) => (
              <div className="lrow" key={`${courtType}-${c.caseNumber || i}`} data-case={c.caseNumber} onClick={() => openCaseDetail(c.caseNumber, courtType)}>
                <div className="lead">
                  <Gavel />
                </div>
                <div className="main-c">
                  <b className="mono">{c.caseNumber}</b>
                  <div className="sub">
                    {c.courtName || '-'} · {c.judge || '-'}
                    {c.hearingDate && c.hearingDate !== '—' && c.hearingDate !== '-' ? ` · ${c.hearingDate}` : ''}
                  </div>
                </div>
                {c.caseStatus ? <span className={`badge ${familyBadgeClass('neutral')}`}>{statusEn(c.caseStatus) || c.caseStatus}</span> : null}
                <div className="amt">
                  {c.claimAmount || '-'}
                  <small>{c.hearingDate || c.dateFiled || ''}</small>
                </div>
                <span className="chev">›</span>
              </div>
            ))}
          </div>
          <ListPagination
            page={safePage}
            pageSize={pageSize}
            total={filtered.length}
            hideWhenSinglePage={false}
            onPage={setPage}
            onPageSize={(n) => {
              setPageSize(n)
              setPage(1)
            }}
          />
        </>
      )}
    </div>
  )
}

/** STIR pretty-print that never leaks DOM deps into the print path. */
function grpSafe(stir: string): string {
  return stir.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')
}

// keep the type imports referenced for API surface completeness
export type { FullCaseGeneral }
