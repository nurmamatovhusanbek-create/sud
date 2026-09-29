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
import { EmptyBlock, SkRows, Seg, familyBadgeClass, SortMenu, applySort, parseSortDate, type SortKey } from '@/components/proto/primitives'
import { ScrapeProgress, SCRAPE_CFG } from '@/components/proto/scrape-progress'
import { openProtoDrawer, closeProtoDrawer, DwSection, DwKv, DwFig, type DwRow } from '@/components/proto/drawer'
import { CaseOrders } from '@/components/proto/case-orders'
import { PartialBanner, ErrorState } from '@/components/ui-custom/states'
import { ListPagination, clampPage } from '@/components/ui-custom/list-pagination'
import { useResource } from '@/hooks/use-resource'
import { dateKey, daysUntil } from '@/core/dates'
import { getCaseDetail, searchCases, searchCompanies, exportCasesXlsx } from '@/lib/api-client'
import { printHtml, escapeHtml } from '@/lib/print'
import { useAppStore } from '@/lib/store/app-store'
import type { CourtType, CourtCase, FullCaseData, Hearing, CaseDetail as FullCaseGeneral } from '@/lib/court-case-types'
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

// ---- Hearing dates ------------------------------------------------------------
// sud.uz sends dd.mm.yyyy; comparing those as STRINGS orders by day first. The date
// helpers live in core/dates.ts (tested) — use them, never raw string comparison.

/** Sortable `yyyy-mm-dd hh:mm` for a hearing. */
function hearingKey(h: { date?: string; time?: string }): string {
  return `${dateKey(h.date)} ${h.time || ''}`
}
const byHearingDate = (a: { date?: string; time?: string }, b: { date?: string; time?: string }) =>
  hearingKey(a).localeCompare(hearingKey(b))

/** The earliest hearing that has not been held AND is not in the past. A past hearing
 *  still marked "scheduled" (postponed / status never updated) is not "next". */
function pickUpcoming<T extends { date?: string; status?: string | null }>(sorted: T[]): T | undefined {
  return sorted.find((h) => !hearingDone(h.status) && (daysUntil(h.date) ?? 0) >= 0)
}

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
  ].sort(byHearingDate)

  // The next hearing = the earliest one not yet held and not in the past. When one
  // exists we show it prominently instead of dumping the whole majlislar history
  // (which is the "too much unnecessary info" the sheet used to carry).
  const nextHearing = pickUpcoming(allHearings)

  // Only the most recent decision is meaningful on a one-page sheet.
  const decisions = [fi?.decision, ap?.decision, ca?.decision].filter(Boolean)
  const lastDecision = decisions[decisions.length - 1]

  const nextSec = nextHearing
    ? `<div class="pr-sec">Keyingi majlis</div>
       <div class="pr-next">
         <div class="pr-next-date">${escapeHtml(nextHearing.date || '-')}${nextHearing.time ? ` · ${escapeHtml(nextHearing.time)}` : ''}</div>
         <div class="pr-next-meta">${escapeHtml(hearingEn(nextHearing.status) || nextHearing.status || 'Rejalashtirilgan')}${nextHearing.courtroom ? ` · ${escapeHtml(nextHearing.courtroom)} zal` : ''}</div>
       </div>`
    : ''

  // Append the resolved STIR when the on-screen detail already looked it up
  // (tinCache is filled by PartyRow) so the PDF matches what's shown.
  const partyVal = (name?: string) => {
    if (!name || name === '-' || name === '—') return '-'
    const tin = tinCache.get(name)
    return tin && /^\d{9}$/.test(tin) ? `${name} · STIR ${tin}` : name
  }
  const parties = `
    <div class="pr-sec">Tomonlar</div>
    ${kv('Daʼvogar', partyVal(g?.plaintiff))}
    ${kv('Javobgar', partyVal(g?.defendant))}`

  const decisionSec = lastDecision
    ? `<div class="pr-sec">Oxirgi qaror${lastDecision.date ? ` · ${escapeHtml(lastDecision.date)}` : ''}</div>
       <div class="pr-text">${escapeHtml(lastDecision.text || '-')}</div>`
    : ''

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
    ${nextSec}
    <div class="pr-sec">Umumiy maʼlumot</div>
    ${kv('Sudya', g?.judge)}
    ${kv('Sud', g?.court)}
    ${kv('Daʼvo summasi', g?.claimAmount)}
    ${kv('Ish turi', g?.caseType)}
    ${parties}
    ${decisionSec}`
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

// The sud.uz case-detail API returns party NAMES but not their STIRs, so we
// resolve them the same way the party link does — by name, via orginfo search.
// One party is usually the company being viewed, so we shortcut that with the
// known STIR; the counterparty resolves on mount (cached per name).
const tinCache = new Map<string, string | null>()

function normParty(s?: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/["«»“”„'’‘ʼ]/g, '')
    .replace(/\b(mchj|aj|qk|ooo|oao|мчж|аж|ак|акж|xk|xususiy korxona)\b/g, '')
    .replace(/[^a-zа-яё0-9 ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function sameParty(a?: string, b?: string): boolean {
  const x = normParty(a), y = normParty(b)
  if (x.length < 3 || y.length < 3) return false
  return x === y || x.includes(y) || y.includes(x)
}

function PartyRow({ label, name, companyName, companyStir, onClose }: {
  label: string
  name?: string
  companyName?: string
  companyStir?: string
  onClose: () => void
}) {
  const empty = !name || name === '-' || name === '—'
  const seed = !empty && sameParty(name, companyName) && /^\d{9}$/.test(companyStir || '')
    ? (companyStir as string)
    : (name ? tinCache.get(name) || '' : '')
  const [tin, setTin] = useState<string>(seed || '')

  useEffect(() => {
    // seed already captured any cached tin at mount; a cached null means we
    // resolved it before and found none — either way, don't re-search.
    if (empty || tin || !name || tinCache.has(name)) return
    let alive = true
    void (async () => {
      const res = await searchCompanies(name)
      const t = res.ok ? res.data.results?.[0]?.tin : undefined
      const val = t && /^\d{9}$/.test(t) ? t : null
      tinCache.set(name, val)
      if (alive && val) setTin(val)
    })()
    return () => { alive = false }
  }, [name, tin, empty])

  const valid = /^\d{9}$/.test(tin)
  const open = () => {
    onClose()
    if (valid) { useAppStore.getState().openCompany(tin); return }
    void (async () => {
      const res = await searchCompanies(name || '')
      if (res.ok && res.data.results?.length) {
        useAppStore.getState().openCompany(res.data.results[0].tin, { name: res.data.results[0].name })
      } else {
        toast.warning('Tomon kompaniya sifatida topilmadi')
      }
    })()
  }

  return (
    <div className="dw-party">
      <div className="body">
        <div className="r">{label}</div>
        {empty ? (
          <span className="n faint">-</span>
        ) : (
          <button className="n" onClick={open}>{name}</button>
        )}
        {valid ? <span className="stir">STIR {tin}</span> : null}
      </div>
      {!empty && <Link2 className="go" aria-hidden />}
    </div>
  )
}

const HIST_SHOWN = 4

/** Past hearings, newest first; only the latest few until expanded. */
function HearingHistory({ items }: { items: Hearing[] }) {
  const [all, setAll] = useState(false)
  const ordered = useMemo(() => [...items].reverse(), [items])
  const shown = all ? ordered : ordered.slice(0, HIST_SHOWN)
  return (
    <>
      <div className="dw-hist">
        {shown.map((h, i) => (
          <div key={i}>
            <b>{h.date}{h.time ? ` · ${h.time}` : ''}</b>
            <span className="m">{hearingEn(h.status) || h.status || '-'}{h.courtroom ? ` · ${h.courtroom}` : ''}</span>
          </div>
        ))}
      </div>
      {ordered.length > HIST_SHOWN && (
        <button className="btn btn-ghost btn-sm dw-more" onClick={() => setAll((v) => !v)}>
          {all ? 'Kamroq koʻrsatish' : `Barchasi (${ordered.length})`}
        </button>
      )}
    </>
  )
}

function openCaseDetail(caseNumber: string, courtType: CourtType, company?: { stir?: string; name?: string }) {
  const EYEBROW = 'Ish tafsiloti'
  openProtoDrawer(
    caseNumber,
    <div style={{ marginTop: 22 }}><SkRows n={5} /></div>,
    'Yuklanmoqda…',
    { eyebrow: EYEBROW },
  )

  void (async () => {
    const res = await getCaseDetail(courtType, caseNumber)
    if (!res.ok) {
      openProtoDrawer(
        caseNumber,
        <div className="alert err" style={{ marginTop: 22 }}>
          <Gavel />
          <div className="at">
            <b>Tafsilotlar olinmadi</b>
            <p>{res.error}</p>
          </div>
        </div>,
        '',
        { eyebrow: EYEBROW },
      )
      return
    }
    const d = res.data
    const g = d.general
    const fi = d.firstInstance
    const ap = d.appellate
    const ca = d.cassation
    const close = () => closeProtoDrawer()

    // One hearing list across instances, oldest → newest. The first one not yet
    // held is the «keyingi majlis» (its own card); the rest is history.
    const allHearings = [
      ...(fi?.hearings ?? []),
      ...(ap?.hearings ?? []),
      ...(ca?.hearings ?? []),
    ].sort(byHearingDate)
    const upcoming = pickUpcoming(allHearings)
    const history = upcoming ? allHearings.filter((h) => h !== upcoming) : allHearings
    const left = upcoming ? daysUntil(upcoming.date) : null

    const decisions = [fi?.decision, ap?.decision, ca?.decision].filter(Boolean)

    const steps: { name: string; state: string; done: boolean }[] = [
      { name: 'Birinchi', inst: fi },
      { name: 'Apellyatsiya', inst: ap },
      { name: 'Kassatsiya', inst: ca },
    ].map(({ name, inst }) => {
      const done = (inst?.hearings.length ?? 0) > 0 || !!inst?.decision
      return { name, done, state: done ? (inst?.decision?.text ? 'Koʻrib chiqilgan' : inst?.appellateOutcome || 'Yozuv bor') : 'Yoʻq' }
    })

    const rows: DwRow[] = [
      ['Sudya', g?.judge],
      ['Kotib', g?.secretary],
      ['Ish turi', g?.caseType],
      ['Daʼvo predmeti', g?.claimSubject],
      ['Uchinchi shaxs', g?.thirdParty],
      ['Vakil', g?.representative],
      ['Prokuror', g?.prosecutor],
      ['Ariza sanasi', g?.applicationDate, { mono: true }],
      ['Qoʻzgatilgan', g?.initiatedDate, { mono: true }],
      ['Muddat', g?.deadlineDate, { mono: true }],
      ['Davlat boji', g?.stateDuty, { mono: true }],
    ]
    const amount = (g?.claimAmount || '').trim()
    const numeric = /^[\d\s.,]+$/.test(amount)

    const printCase = () => {
      try {
        printHtml(`Ish ${caseNumber}`, caseDetailHtml(caseNumber, d))
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Chop etib boʻlmadi')
      }
    }

    const statusColor = g?.caseStatus ? CASE_STATUSES[g.caseStatus]?.color : undefined
    openProtoDrawer(
      caseNumber,
      <div>
        {amount && amount !== '-' && (
          <div style={{ marginTop: 22 }}>
            <DwFig label="Daʼvo summasi" value={amount} unit={numeric ? 'soʻm' : undefined} />
          </div>
        )}

        {upcoming && (
          <DwSection title="Keyingi majlis">
            <div className="dw-next">
              <div>
                <div className="d">{upcoming.date}{upcoming.time ? ` · ${upcoming.time}` : ''}</div>
                <div className="m">{hearingEn(upcoming.status) || upcoming.status || 'Rejalashtirilgan'}{upcoming.courtroom ? ` · ${upcoming.courtroom} zal` : ''}</div>
              </div>
              {left !== null && left >= 0 && (
                <span className="badge b-info days">{left === 0 ? 'Bugun' : `${left} kun qoldi`}</span>
              )}
            </div>
          </DwSection>
        )}

        <DwSection title="Umumiy maʼlumot">
          <DwKv rows={rows} />
        </DwSection>

        <DwSection title="Tomonlar">
          <PartyRow label="Daʼvogar" name={g?.plaintiff} companyName={company?.name} companyStir={company?.stir} onClose={close} />
          <PartyRow label="Javobgar" name={g?.defendant} companyName={company?.name} companyStir={company?.stir} onClose={close} />
        </DwSection>

        {history.length > 0 && (
          <DwSection title="Majlislar tarixi" count={history.length}>
            <HearingHistory items={history} />
          </DwSection>
        )}

        {decisions.length > 0 && (
          <DwSection title={decisions.length > 1 ? 'Qarorlar' : 'Qaror'}>
            {decisions.map((dec, i) => (
              <div className="dw-quote" key={i}>
                <div className="d">{dec!.date || '-'}</div>
                <p>{dec!.text || '-'}</p>
              </div>
            ))}
          </DwSection>
        )}

        <CaseOrders caseNumber={caseNumber} />

        <DwSection title="Instansiyalar">
          <div className="dw-track">
            {steps.map((st) => (
              <div className={`dw-step${st.done ? ' done' : ''}`} key={st.name}>
                <b>{st.name}</b>
                <span>{st.state}</span>
              </div>
            ))}
          </div>
        </DwSection>
      </div>,
      g?.court || '',
      {
        eyebrow: EYEBROW,
        badges: g?.caseStatus ? (
          <span className="badge b-neu" style={{ height: 26 }}>
            <i className="p-dot" style={{ background: statusColor }} />
            {statusEn(g.caseStatus) || g.caseStatus}
          </span>
        ) : undefined,
        footer: (
          <button className="btn btn-primary" onClick={printCase}>
            <Download />
            <span>PDF sifatida saqlash</span>
          </button>
        ),
      },
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
  const [sort, setSort] = useState<SortKey>('new')
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
      if (d?.caseNumber) openCaseDetail(d.caseNumber, (d.courtType as CourtType) || 'economic', company ?? undefined)
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
    const list = q
      ? merged.filter(({ c }) => Object.values(c).some((v) => typeof v === 'string' && v.toLowerCase().includes(q)))
      : merged
    return applySort(
      list,
      sort,
      ({ c }) => parseSortDate(c.hearingDate || c.dateFiled),
      ({ c }) => c.caseNumber || '',
    )
  }, [merged, query, sort])

  // Reset to page 1 whenever the list-shaping inputs change
  useEffect(() => {
    setPage(1)
  }, [query, courtFilter, sort, stir])

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
        <SortMenu value={sort} onChange={setSort} />
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
              <div className="lrow" key={`${courtType}-${c.caseNumber || i}`} data-case={c.caseNumber} onClick={() => openCaseDetail(c.caseNumber, courtType, company ?? undefined)}>
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
