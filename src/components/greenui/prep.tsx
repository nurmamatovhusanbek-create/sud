'use client'

/**
 * «Majlisga tayyorgarlik» — one screen for the job «I have a hearing; what do I need?». It reads the case (one click
 * started it), says which side the company is on, shows what is already settled and what is open as a checklist, how
 * the company has fared against THIS counterparty before, and prepares the petition forms from the case in one click.
 * The ticks are kept in the browser per case (lib/prep-store); the checklist rules live in core/prep (tested).
 */

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, FileText, Lock, ScrollText } from 'lucide-react'
import { toast } from 'sonner'
import { calendarDaysUntil, longDate } from '@/core/agenda'
import { groupDigits } from '@/core/billing-format'
import { partyRole } from '@/core/classify'
import { counterpartyRecord } from '@/core/counterparty'
import { prepChecklist, prepProgress } from '@/core/prep'
import { useAppStore } from '@/lib/store/app-store'
import { getCaseDetail, getStats } from '@/lib/api-client'
import { getCached } from '@/lib/cache'
import type { CompanyStats } from '@/lib/api-types'
import type { CourtType, FullCaseData } from '@/lib/court-case-types'
import { caseToDocValuesFor, PREFILLABLE_DOCS } from '@/lib/documents/from-case'
import { docById } from '@/lib/documents/registry'
import { readPrep, writePrep, type PrepState } from '@/lib/prep-store'
import { cn } from '@/lib/utils'
import { openCaseDetail } from '@/components/sections/cases'

const COURTS: CourtType[] = ['economic', 'civil', 'administrative']
const OUT: Record<string, string> = { win: 'yutgan', lose: 'yutqazgan', pending: 'jarayonda', neutral: 'neytral' }
const real = (v?: string) => (v && v !== '—' && v !== '-' ? v.trim() : '')

function Ring({ done, total }: { done: number; total: number }) {
  const r = 22
  const c = 2 * Math.PI * r
  return (
    <span className="gx-pring" title={`${done} / ${total} tayyor`}>
      <svg viewBox="0 0 56 56" aria-hidden>
        <circle cx="28" cy="28" r={r} className="t" />
        <circle cx="28" cy="28" r={r} className="v" strokeDasharray={`${(c * done) / total} ${c}`} transform="rotate(-90 28 28)" />
      </svg>
      <b>{done}<small>/{total}</small></b>
    </span>
  )
}

export function GreenPrep() {
  const t = useAppStore((s) => s.prepTarget)
  const setSurface = useAppStore((s) => s.setSurface)
  const openCompany = useAppStore((s) => s.openCompany)
  const setDocPrefill = useAppStore((s) => s.setDocPrefill)

  const [detail, setDetail] = useState<{ courtType: CourtType; data: FullCaseData } | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [stats, setStats] = useState<CompanyStats | null>(null)
  const [statsBusy, setStatsBusy] = useState(false)
  const [prep, setPrep] = useState<PrepState>({ ticked: [], documentPrepared: false, at: 0 })

  const key = t ? `${t.stir}|${t.caseNumber}` : ''
  // the saved ticks and the cached statistics live in the browser: read them when the target changes
  useEffect(() => {
    if (!t) return
    setPrep(readPrep(t.stir, t.caseNumber))
    setStats(getCached<CompanyStats>(`stats:${t.stir}`))
  }, [key])

  // read the case: the court type comes from the target, else from the cached statistics, else the three are tried in turn
  useEffect(() => {
    if (!t) return
    let alive = true
    setState('loading')
    setDetail(null)
    void (async () => {
      const cached = getCached<CompanyStats>(`stats:${t.stir}`)?.cases.find((c) => c.caseNumber === t.caseNumber)?.courtType
      const order = (t.courtType ? [t.courtType] : cached ? [cached] : COURTS) as CourtType[]
      for (const ct of order) {
        const res = await getCaseDetail(ct, t.caseNumber)
        if (!alive) return
        if (res.ok && res.data.general) {
          setDetail({ courtType: ct, data: res.data })
          setState('ready')
          return
        }
      }
      setState('missing')
    })()
    return () => { alive = false }
  }, [key])

  const g = detail?.data.general ?? null
  const role = useMemo(() => (t && g ? partyRole({ names: [t.name], tin: t.stir }, g.plaintiff, g.defendant) : null), [t, g])
  const other = role === 'plaintiff' ? real(g?.defendant) : role === 'defendant' ? real(g?.plaintiff) : ''
  const record = useMemo(
    () => (stats && other && t ? counterpartyRecord(stats.cases.map((c) => ({ caseNumber: c.caseNumber, counterparty: c.counterparty, classification: c.classification, regDate: c.regDate })), other, t.caseNumber) : null),
    [stats, other, t],
  )

  if (!t) {
    return (
      <div className="gx-clear"><ScrollText aria-hidden /><b>Majlis tanlanmagan</b><span>Bugun sahifasidan majlisni tanlang.</span></div>
    )
  }

  const items = prepChecklist({ caseRead: state === 'ready', representative: !!real(g?.representative), documentPrepared: prep.documentPrepared }, new Set(prep.ticked))
  const progress = prepProgress(items)
  const days = t.iso ? calendarDaysUntil(t.iso) : null
  const now = new Date()

  const tick = (id: string) => setPrep(writePrep(t.stir, t.caseNumber, { ticked: prep.ticked.includes(id) ? prep.ticked.filter((x) => x !== id) : [...prep.ticked, id] }))

  const prepareDoc = (docId: string) => {
    const values = caseToDocValuesFor(docId, {
      caseNumber: t.caseNumber,
      general: g ? { court: g.court, judge: g.judge, plaintiff: g.plaintiff, claimSubject: g.claimSubject } : null,
      upcoming: t.iso ? { date: t.iso, time: t.time } : null,
      companyName: t.name,
    })
    writePrep(t.stir, t.caseNumber, { documentPrepared: true })
    setDocPrefill({ docId, values })
    setSurface('documents')
  }

  const loadStats = () => {
    if (statsBusy) return
    setStatsBusy(true)
    void getStats(t.stir)
      .then((r) => { if (r.ok) setStats(r.data); else toast.error(r.error) })
      .finally(() => setStatsBusy(false))
  }

  const amount = real(g?.claimAmount)

  return (
    <div className="gx-prep">
      <button type="button" className="gx-back" onClick={() => { setSurface('main'); useAppStore.getState().goLauncher() }}>
        <ArrowLeft /> Bugun
      </button>

      <header className="gx-prep-h">
        <div className="gx-prep-id">
          <span className="gx-prep-eb">Majlisga tayyorgarlik</span>
          <h1 className="mono">{t.caseNumber}</h1>
          <p>{real(g?.court) || t.court || '—'}{real(g?.judge) || t.judge ? ` · ${real(g?.judge) || t.judge}` : ''}</p>
          <div className="gx-chips">
            {t.iso && <span className={cn('gx-chip', days !== null && days <= 1 && 'hot')}>{days === 0 ? 'Bugun' : days === 1 ? 'Ertaga' : days !== null && days > 0 ? `${days} kundan keyin` : 'Oʻtgan'}, {longDate(t.iso, now)}{t.time ? ` · ${t.time}` : ''}</span>}
            {role && <span className="gx-chip">{role === 'plaintiff' ? 'Kompaniya daʼvogar' : 'Kompaniya javobgar'}</span>}
            <button type="button" className="gx-chip" onClick={() => openCompany(t.stir, { name: t.name }, 'brief')}>{t.name || `STIR ${t.stir}`}</button>
          </div>
        </div>
        <Ring done={progress.done} total={progress.total} />
      </header>

      {state === 'missing' && <div className="alert warn"><div className="at"><b>Ish oʻqilmadi</b><p>Iqtisodiy, fuqarolik va maʼmuriy sudlarda bu raqam topilmadi. Tarmoq yoki manba muammosi boʻlishi mumkin.</p></div></div>}

      <div className="gx-prep-grid">
        <div className="gx-prep-col">
          <section className="gx-panel" aria-label="Tayyorgarlik roʻyxati">
            <div className="gx-panel-h"><h2>Tayyorgarlik</h2><span className={cn('g-count', progress.ready && 'ready')}>{progress.ready ? 'Tayyor' : `${progress.done}/${progress.total}`}</span></div>
            <ul className="gx-checks">
              {items.map((it) => (
                <li key={it.id}>
                  <button type="button" className={cn('gx-check', it.done && 'done')} disabled={it.auto} onClick={() => tick(it.id)} aria-pressed={it.done}>
                    <span className="box" aria-hidden>{it.done ? <Check /> : null}</span>
                    <span className="tx"><b>{it.label}</b><small>{it.hint}</small></span>
                    {it.auto ? <span className="auto" title="Dastur oʻzi aniqladi"><Lock /> avtomatik</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="gx-panel" aria-label="Hujjatlar">
            <div className="gx-panel-h"><h2>Hujjatlar</h2></div>
            <div className="gx-docs">
              {PREFILLABLE_DOCS.map((id) => (
                <button key={id} type="button" className="btn btn-outline btn-sm" disabled={state !== 'ready'} onClick={() => prepareDoc(id)}>
                  <FileText /><span>{docById(id)?.title}</span>
                </button>
              ))}
            </div>
            <p className="gx-hint">Sud, sudya, ish raqami, daʼvogar, daʼvo predmeti va majlis sanasi shu ishdan avtomatik toʻldiriladi.</p>
          </section>
        </div>

        <div className="gx-prep-col">
          {amount && (
            <div className="gx-fig"><span>Daʼvo summasi</span><b>{/^[\d\s.,]+$/.test(amount) ? groupDigits(amount) : amount}{/^[\d\s.,]+$/.test(amount) ? <small>soʻm</small> : null}</b></div>
          )}

          <section className="gx-panel" aria-label="Qarshi tomon">
            <div className="gx-panel-h"><h2>Qarshi tomon</h2></div>
            {state === 'loading' ? (
              <p className="gx-hint">Ish oʻqilmoqda…</p>
            ) : !other ? (
              <p className="gx-hint">Kompaniya qaysi tomonda ekani aniqlanmadi, shuning uchun qarshi tomon nomaʼlum.</p>
            ) : (
              <>
                <p className="gx-opp">{other}</p>
                {!stats ? (
                  <div className="gx-hint">Avvalgi ishlarni koʻrish uchun kompaniya statistikasi kerak.{' '}
                    <button type="button" className="btn btn-outline btn-sm" disabled={statsBusy} onClick={loadStats}>{statsBusy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : null}Statistikani yuklash</button>
                  </div>
                ) : record && record.total > 0 ? (
                  <>
                    <p className="gx-rec">Shu tomon bilan <b>{record.total}</b> ta boshqa ish:{' '}
                      {(['win', 'lose', 'pending', 'neutral'] as const).filter((k) => record[k] > 0).map((k) => `${record[k]} ${OUT[k]}`).join(', ')}.</p>
                    <ul className="gx-recs">{record.cases.slice(0, 6).map((n) => {
                      const c = stats.cases.find((x) => x.caseNumber === n)
                      return <li key={n}><button type="button" className="gx-rec-c" onClick={() => c && openCaseDetail(n, c.courtType as CourtType, { stir: t.stir, name: t.name })}><span className="mono">{n}</span><i className={`o-${c?.classification}`}>{c ? OUT[c.classification] : ''}</i></button></li>
                    })}</ul>
                  </>
                ) : (
                  <p className="gx-hint">Oʻqilgan ishlar ichida bu tomon bilan boshqa ish yoʻq.</p>
                )}
              </>
            )}
          </section>

          <section className="gx-panel" aria-label="Ish">
            <div className="gx-panel-h"><h2>Ish</h2></div>
            <dl className="gx-kv">
              {([['Daʼvogar', g?.plaintiff], ['Javobgar', g?.defendant], ['Ish turi', g?.caseType], ['Daʼvo predmeti', g?.claimSubject], ['Holati', g?.caseStatus], ['Vakil', g?.representative], ['Davlat boji', g?.stateDuty]] as [string, string | undefined][])
                .filter(([, v]) => real(v))
                .map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{real(v)}</dd></div>))}
            </dl>
            {detail && (
              <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={() => openCaseDetail(t.caseNumber, detail.courtType, { stir: t.stir, name: t.name })}>
                Toʻliq tafsilot, tarix va qarorlar
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
