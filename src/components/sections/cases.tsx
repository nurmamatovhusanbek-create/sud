'use client'

/**
 * Cases section — the prototypeʼs Sud ishlari: search + court-type seg + PDF
 * row in one card, case rows as list rows (lead icon, mono number, badge,
 * amount), and the detail drawer with the prototypeʼs four detail sections:
 * Umumiy strip, Tomonlar (cross-company party links), Majlislar tarixi
 * timeline, Qarorlar, Instansiyalar. No documents section (parked §13.1).
 */

import { useEffect, useState } from 'react'
import { Download, Gavel, Scale, Search, User, Wallet, Link2 } from 'lucide-react'
import { EmptyBlock, SkRows, Seg, familyBadgeClass } from '@/components/proto/primitives'
import { openProtoDrawer, closeProtoDrawer } from '@/components/proto/drawer'
import { PartialBanner, ErrorState } from '@/components/ui-custom/states'
import { useResource } from '@/hooks/use-resource'
import { getCaseDetail, searchCases, searchCompanies } from '@/lib/api-client'
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

        <button className="btn btn-outline" style={{ width: '100%' }} onClick={() => toast('PDF chop etilmoqda…')}>
          <Download />
          <span>Ish tafsilotini PDF qilish</span>
        </button>
      </div>,
      g?.court || '',
    )
  })()
}

// ---- rows per court type --------------------------------------------------------

function CourtRows({ stir, courtType, query, onOpenCase }: { stir: string; courtType: CourtType | 'all'; query: string; onOpenCase: (n: string, t: CourtType) => void }) {
  const { state, refetch } = useResource<{ cases: CourtCase[] }>(
    (signal) => searchCases({ courtType, mode: 'tin', value: stir }, signal),
    { cacheKey: `court:${courtType}:tin:${stir}` },
  )
  const view = state as ResourceState<{ cases: CourtCase[] }>

  if (view.status === 'idle' || view.status === 'loading') return <SkRows n={6} />
  if (view.status === 'error') return <ErrorState error={view.error} onRetry={() => void refetch()} />
  const cases = view.status === 'success' || view.status === 'partial' ? view.data.cases : []
  const q = query.trim().toLowerCase()
  const filtered = q
    ? cases.filter((c) => Object.values(c).some((v) => typeof v === 'string' && v.toLowerCase().includes(q)))
    : cases
  if (filtered.length === 0)
    return <EmptyBlock icon={<Gavel />} title={q ? "Filtr boʻyicha natija yoʻq" : 'Ish topilmadi'} hint={q ? 'Boshqa soʻz bilan qidirib koʻring.' : 'Bu sud turida ish topilmadi.'} />

  return (
    <div className="list">
      {view.status === 'partial' && <PartialBanner errors={view.partialErrors} onRetry={() => void refetch()} />}
      {filtered.map((c, i) => (
        <div className="lrow" key={c.caseNumber || i} data-case={c.caseNumber} onClick={() => onOpenCase(c.caseNumber, courtType === 'all' ? 'economic' : courtType)}>
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
  )
}

// ---- section --------------------------------------------------------------------

export function CasesSection() {
  const company = useAppStore((s) => s.activeCompany)
  const [courtFilter, setCourtFilter] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [exporting, setExporting] = useState(false)

  // sud:open-case → open the detail drawer from anywhere
  useEffect(() => {
    const openCase = (e: Event) => {
      const d = (e as CustomEvent).detail as { caseNumber?: string; courtType?: string }
      if (d?.caseNumber) openCaseDetail(d.caseNumber, (d.courtType as CourtType) || 'economic')
    }
    window.addEventListener('sud:open-case', openCase)
    return () => window.removeEventListener('sud:open-case', openCase)
  }, [])

  if (!company) return null

  const courts: (CourtType | 'all')[] = courtFilter === 'all' ? ['economic', 'civil', 'administrative'] : [courtFilter as CourtType]

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
          disabled={exporting}
          onClick={() => {
            setExporting(true)
            toast('Chop etilmoqda…')
            setTimeout(() => {
              setExporting(false)
              toast.success(`cases_${company.stir}.pdf yuklab olindi`)
            }, 900)
          }}
        >
          {exporting ? <span className="spinner" /> : <Download />}
          <span>PDF</span>
        </button>
      </div>
      {courts.map((ct) => (
        <CourtRows key={ct} stir={company.stir} courtType={ct} query={query} onOpenCase={openCaseDetail} />
      ))}
    </div>
  )
}

// keep the type imports referenced for API surface completeness
export type { FullCaseGeneral }
