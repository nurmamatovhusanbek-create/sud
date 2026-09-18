'use client'

/**
 * Cases section — the prototypeʼs Sud ishlari: search + court-type seg + PDF/
 * Excel row in one card, case rows as list rows, and the detail drawer with
 * the prototypeʼs four detail sections.
 *
 * v204 (P-D): ONE merged, filtered case list in the parent (no per-court child
 * fetches) + pagination with a per-page selector; rows carry their own
 * courtType (fixes the "all" seg opening cases under the wrong type).
 * v205 (§6.5): the merged list comes from /api/company-cases — live TIN results
 * PLUS name-discovered rows from the docket index (badged "Nomdan topildi").
 * v204 (P-C): PDF buttons use real print sheets; Excel exports via
 * /api/court-cases/export.
 */

import { useEffect, useMemo, useState } from 'react'
import { Download, Gavel, Scale, Search, User, Wallet, Link2, FileSpreadsheet } from 'lucide-react'
import { EmptyBlock, SkRows, Seg, familyBadgeClass } from '@/components/proto/primitives'
import { openProtoDrawer, closeProtoDrawer } from '@/components/proto/drawer'
import { PartialBanner, ErrorState } from '@/components/ui-custom/states'
import { useResource } from '@/hooks/use-resource'
import { getCaseDetail, getCompanyCases, searchCompanies, exportCasesXlsx } from '@/lib/api-client'
import type { AggCaseData } from '@/lib/api-client'
import { printHtml, esc } from '@/lib/print'
import { useAppStore } from '@/lib/store/app-store'
import type { CourtType, FullCaseData, CaseDetail as FullCaseGeneral } from '@/lib/court-case-types'
import { CASE_STATUSES, HEARING_STATUSES } from '@/lib/court-case-types'
import { ListPagination, PageSizeSelect, clampPage, DEFAULT_PAGE_SIZE } from '@/components/ui-custom/list-pagination'
import { toast } from 'sonner'

const COURT_SEG: { key: string; label: string }[] = [
  { key: 'all', label: 'Barchasi' },
  { key: 'economic', label: 'Iqtisodiy' },
  { key: 'civil', label: 'Fuqarolik' },
  { key: 'administrative', label: "Maʼmuriy" },
]

const SUD_TURI: Record<string, string> = {
  economic: 'Iqtisodiy',
  civil: 'Fuqarolik',
  administrative: "Maʼmuriy",
}

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

    // v204 (P-C): real print sheet for the case detail
    const printDetail = () => {
      const kv = (pairs: [string, string][]) =>
        pairs
          .map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span>${esc(v)}</span></div>`)
          .join('')
      const hearingsHtml = allHearings.length
        ? `<table><thead><tr><th>Sana</th><th>Vaqt</th><th>Holat</th><th>Zal</th></tr></thead><tbody>${allHearings
            .map(
              (h) =>
                `<tr><td>${esc(h.date)}</td><td>${esc(h.time || '-')}</td><td>${esc(
                  hearingEn(h.status) || h.status || '-',
                )}</td><td>${esc(h.courtroom || '-')}</td></tr>`,
            )
            .join('')}</tbody></table>`
        : ''
      const decisionsHtml = decisions.length
        ? `<h2>Qarorlar</h2>${decisions
            .map((dec) => `<div class="kv"><span>${esc(dec!.date || '-')}</span><span>${esc(dec!.text || '-')}</span></div>`)
            .join('')}`
        : ''
      const html =
        `<h1>Ish ${esc(caseNumber)}</h1>` +
        `<div class="muted">${esc(SUD_TURI[courtType] || courtType)}</div>` +
        `<h2>Umumiy maʼlumot</h2>` +
        kv([
          ['Sudya', g?.judge || '-'],
          ['Daʼvo summasi', g?.claimAmount || '-'],
          ['Sud', g?.court || '-'],
          ['Holat', statusEn(g?.caseStatus) || g?.caseStatus || '-'],
        ]) +
        `<h2>Tomonlar</h2>` +
        kv([
          ['Daʼvogar', g?.plaintiff || '-'],
          ['Daʼvogar STIR', g?.plaintiffTin || '-'],
          ['Javobgar', g?.defendant || '-'],
          ['Javobgar STIR', g?.defendantTin || '-'],
        ]) +
        (hearingsHtml ? `<h2>Majlislar tarixi</h2>${hearingsHtml}` : '') +
        decisionsHtml
      const ok = printHtml(`Ish ${caseNumber}`, html)
      if (!ok) toast.error('Pop-up oynasi bloklandi — brauzerda ruxsat bering')
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

        <button className="btn btn-outline" style={{ width: '100%' }} onClick={printDetail}>
          <Download />
          <span>Ish tafsilotini PDF qilish</span>
        </button>
      </div>,
      g?.court || '',
    )
  })()
}

// ---- section --------------------------------------------------------------------

export function CasesSection() {
  const company = useAppStore((s) => s.activeCompany)
  const stir = company?.stir
  const [courtFilter, setCourtFilter] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [exporting, setExporting] = useState(false)
  // v204 (P-D): pagination + per-page (restores the old app's casePageSize)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  // v205 (§6.5): ONE merged fetch (live TIN across all three types + name
  // discovery from the docket index when configured)
  const { state, refetch } = useResource<{ cases: AggCaseData[]; partial: string[] }>(
    (signal) => getCompanyCases(stir!, signal),
    { cacheKey: `company-cases:${stir}`, enabled: !!stir },
  )

  // sud:open-case → open the detail drawer from anywhere
  useEffect(() => {
    const openCase = (e: Event) => {
      const d = (e as CustomEvent).detail as { caseNumber?: string; courtType?: string }
      if (d?.caseNumber) openCaseDetail(d.caseNumber, (d.courtType as CourtType) || 'economic')
    }
    window.addEventListener('sud:open-case', openCase)
    return () => window.removeEventListener('sud:open-case', openCase)
  }, [])

  // v204 (P-D): reset to the first page whenever the filter result changes
  useEffect(() => {
    setPage(1)
  }, [query, courtFilter, stir])

  const all: AggCaseData[] = useMemo(
    () =>
      state.status === 'success' || state.status === 'partial'
        ? state.data.cases
        : [],
    [state],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter(
      (c) =>
        (courtFilter === 'all' || c.courtType === courtFilter) &&
        (!q ||
          Object.values(c).some((v) => typeof v === 'string' && v.toLowerCase().includes(q))),
    )
  }, [all, query, courtFilter])

  const safePage = clampPage(page, filtered.length, pageSize)
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const printList = () => {
    const rows = filtered
      .map(
        (c) =>
          `<tr><td>${esc(c.caseNumber)}</td><td>${esc(c.courtName)}</td><td>${esc(
            c.plaintiff,
          )}</td><td>${esc(c.defendant)}</td><td>${esc(c.hearingDate || c.dateFiled || '-')}</td><td>${esc(
            SUD_TURI[c.courtType] || c.courtType,
          )}</td></tr>`,
      )
      .join('')
    const ok = printHtml(
      `Sud ishlari — ${company?.name || company?.stir || ''}`,
      `<h1>Sud ishlari</h1><div class="muted">${esc(company?.name || '')} · STIR ${esc(
        company?.stir || '',
      )} · ${filtered.length} ta ish</div>
      <table><thead><tr><th>Ish raqami</th><th>Sud</th><th>Daʼvogar</th><th>Javobgar</th><th>Sana</th><th>Sud turi</th></tr></thead>
      <tbody>${rows}</tbody></table>`,
    )
    if (!ok) toast.error('Pop-up oynasi bloklandi — brauzerda ruxsat bering')
  }

  const exportExcel = () => {
    setExporting(true)
    void (async () => {
      try {
        await exportCasesXlsx(stir!)
        toast.success('Excel yuklab olindi')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Eksport xatosi')
      } finally {
        setExporting(false)
      }
    })()
  }

  if (!company) return null

  const view = state

  return (
    <div className="p-card rise-c">
      <div className="filterbar">
        <div className="f-search">
          <Search />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ish raqami, sudya, tomon yoki bosqich…" />
        </div>
        <Seg options={COURT_SEG} value={courtFilter} onChange={setCourtFilter} />
        <div style={{ flex: 1 }} />
        <PageSizeSelect value={pageSize} onChange={(n) => setPageSize(n)} />
        <button className="btn btn-outline btn-sm" onClick={printList} disabled={filtered.length === 0}>
          <Download />
          <span>PDF</span>
        </button>
        <button className="btn btn-outline btn-sm" onClick={exportExcel} disabled={exporting || all.length === 0}>
          {exporting ? <span className="spinner" /> : <FileSpreadsheet />}
          <span>Excel</span>
        </button>
      </div>

      {view.status === 'idle' || view.status === 'loading' ? (
        <SkRows n={6} />
      ) : view.status === 'error' ? (
        <ErrorState error={view.error} onRetry={() => void refetch()} />
      ) : view.status === 'empty' ? (
        <EmptyBlock icon={<Gavel />} title="Ish topilmadi" hint="Bu STIR boʻyicha sud ishlari topilmadi." />
      ) : (
        <>
          {/* v205: honest partial reporting from the merged endpoint */}
          {view.status === 'partial' ? (
            <PartialBanner errors={view.partialErrors} onRetry={() => void refetch()} />
          ) : (view.data.partial?.length ?? 0) > 0 ? (
            <PartialBanner
              errors={view.data.partial.map((t) => ({
                source: SUD_TURI[t] || t,
                error: 'bu sud turiga ulanib boʻlmadi — natija toʻliq boʻlmasligi mumkin',
              }))}
              onRetry={() => void refetch()}
            />
          ) : null}

          {all.length === 0 ? (
            <EmptyBlock icon={<Gavel />} title="Ish topilmadi" hint="Bu STIR boʻyicha sud ishlari topilmadi." />
          ) : filtered.length === 0 ? (
            <EmptyBlock icon={<Search />} title="Filtr boʻyicha natija yoʻq" hint="Boshqa soʻz bilan qidirib koʻring." />
          ) : (
            <div className="list">
              {paged.map((c, i) => (
                <div
                  className="lrow"
                  key={c.caseNumber || i}
                  data-case={c.caseNumber}
                  onClick={() => openCaseDetail(c.caseNumber, (c.courtType as CourtType) || 'economic')}
                >
                  <div className="lead">
                    <Gavel />
                  </div>
                  <div className="main-c">
                    <b className="mono">
                      {c.caseNumber}
                      {c.source === 'name' ? (
                        <span className="badge b-neu" style={{ marginLeft: 8, fontSize: 10, height: 18 }} title="Docket indeksidan nom boʻyicha topildi (TIN yozilmagan)">
                          Nomdan topildi
                        </span>
                      ) : null}
                    </b>
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
          )}
          {filtered.length > 0 ? (
            <ListPagination
              page={safePage}
              pageSize={pageSize}
              total={filtered.length}
              onPageChange={setPage}
            />
          ) : null}
        </>
      )}
    </div>
  )
}

// keep the type imports referenced for API surface completeness
export type { FullCaseGeneral, FullCaseData }
